#!/usr/bin/env node

import fsSync from "node:fs";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localizeRendererText, resolveProposalRendererLocale } from "./kp_pdf_reference_locale.mjs";
import { buildProductDeliveryInventory, decomposeProductMapDetail } from "./kp_product_map_model.mjs";

const DEFAULT_DPI = 120;
const EXPECTED_ASPECT_RATIO = Number(process.env.KP_PDF_EXPECTED_RATIO || 3 / 2);
const EXPECTED_PAGE_COUNT_INPUT = Number(process.env.KP_PDF_EXPECTED_PAGES || 0);
const EXPECTED_PAGE_COUNT = Number.isInteger(EXPECTED_PAGE_COUNT_INPUT) && EXPECTED_PAGE_COUNT_INPUT > 0
  ? EXPECTED_PAGE_COUNT_INPUT
  : 0;
const FORBID_COVER_PRICE = process.env.KP_PDF_ALLOW_COVER_PRICE !== "1";
const BUNDLED_DEPENDENCIES = path.join(
  os.homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
);

const V5_MIN_TEXT_BY_KIND = Object.freeze({
  cover: 70,
  opening_manifesto: 100,
  chapter_why_now: 36,
  problem: 100,
  market_research: 120,
  market_sizing: 40,
  analog_research: 120,
  launch_boundary: 90,
  chapter_product: 36,
  product_map: 90,
  design_project: 100,
  primary_flow: 70,
  architecture: 90,
  client_dependencies: 120,
  swot: 120,
  chapter_delivery: 36,
  function_price: 120,
  team: 100,
  roadmap: 90,
  project_price: 80,
  payments: 120,
  close: 100,
});

/**
 * Build the smallest renderer-independent expectation set G5 needs.  It never
 * copies narrative/source text into the QA subprocess: only client identity,
 * locked commercial rows, explicit plan titles and close-page decisions.
 */
export function buildPdfContentExpectations({
  mode = "v5",
  presentationPlan = null,
  proposalModel = null,
  semanticModel = null,
  commercialLock = null,
  expectedPageCount = 0,
  domReport = null,
} = {}) {
  const plannedPages = Array.isArray(presentationPlan?.pages) ? presentationPlan.pages : [];
  const resolvedExpectedPageCount = Number(presentationPlan?.pageCount || expectedPageCount || 0);
  const pageTitles = (presentationPlan?.pages || [])
    .filter((page) => typeof page?.title === "string" && page.title.trim())
    .map((page) => ({ page: Number(page.pageNumber), title: safeExpectationText(page.title, 160) }));
  const pageByKind = Object.fromEntries(plannedPages
    .filter((page) => typeof page?.kind === "string" && page.kind.trim() && Number.isInteger(Number(page?.pageNumber)))
    .map((page) => [page.kind, Number(page.pageNumber)]));
  const pagesByKind = Object.fromEntries([...new Set(plannedPages.map((page) => page?.kind).filter(Boolean))]
    .map((kind) => [kind, plannedPages.filter((page) => page?.kind === kind).map((page) => Number(page.pageNumber))]));
  const domPageInventory = Array.isArray(domReport?.uiHardcheck?.perPage) ? domReport.uiHardcheck.perPage : [];
  const pageIdentities = plannedPages.map((planned) => {
    const domPage = domPageInventory.find((row) => Number(row?.pageNumber) === Number(planned?.pageNumber));
    const visibleTitle = safeExpectationText(
      domPage?.visibleTitle || domPage?.titleText || domPage?.headingText || "",
      240,
    );
    const rawTokens = domPage?.visibleTokens || domPage?.normalizedTokens || domPage?.clientTokens || [];
    const visibleTokens = [...new Set((Array.isArray(rawTokens) ? rawTokens : [])
      .map((value) => safeExpectationToken(value))
      .filter(Boolean))].slice(0, 320);
    return {
      page: Number(planned?.pageNumber),
      kind: safeExpectationText(planned?.kind || "", 80),
      visibleTitle,
      visibleTokens,
    };
  });
  const closePage = plannedPages.find((page) => page?.kind === "close");
  const closeCta = (closePage?.contentBlocks || []).find((block) => block?.kind === "cta") || {};
  const lock = commercialLock && typeof commercialLock === "object" ? commercialLock : null;
  const rendererLocale = resolveProposalRendererLocale(proposalModel || {});
  const localizedExpectationText = (value, maxLength) => safeExpectationText(
    localizeRendererText(value, rendererLocale),
    maxLength,
  );
  const currency = String(lock?.currency || proposalModel?.pricing?.currency || "USD").toUpperCase();
  const currencyStatus = String(
    proposalModel?.pricing?.currencyStatus
      || proposalModel?.groundedBrief?.budget?.currency?.status
      || (currency === "XXX" ? "unknown" : "explicit"),
  ).toLowerCase();
  const exponent = Number.isInteger(lock?.currencyExponent) ? lock.currencyExponent : 2;
  const projectPriceMinor = lock
    ? Number(lock.projectPriceMinor)
    : majorToMinorForExpectation(proposalModel?.pricing?.projectPrice ?? proposalModel?.pricing?.total, exponent);
  const briefBudgetMinor = majorToMinorForExpectation(
    proposalModel?.pricing?.budgetAmount ?? proposalModel?.groundedBrief?.budget?.amount?.value,
    exponent,
  );
  const proposalFunctionRows = Array.isArray(proposalModel?.functionPrice) ? proposalModel.functionPrice : [];
  const proposalFunctionById = new Map(proposalFunctionRows.map((row) => [String(row?.id || ""), row]));
  const commercialFunctionRows = lock
    ? (lock.functionPrice || []).map((row) => {
        const proposalRow = proposalFunctionById.get(String(row.id || "")) || {};
        return {
          label: localizedExpectationText(row.name, 200),
          detail: localizedExpectationText(proposalRow.detail || "", 240),
          deadline: localizedExpectationText(proposalRow.phase || proposalRow.deadline || "", 80),
          amountMinor: Number(row.amountMinor),
        };
      })
    : (proposalModel?.functionPrice || []).map((row) => ({
        label: localizedExpectationText(row.name || row.title || row.feature || "", 200),
        detail: localizedExpectationText(row.detail || row.subtask || "", 240),
        deadline: localizedExpectationText(row.phase || row.deadline || "", 80),
        amountMinor: majorToMinorForExpectation(row.total ?? row.amount, exponent),
      }));
  const canonicalDeliveryInventory = buildProductDeliveryInventory(semanticModel || {});
  const functionRows = canonicalDeliveryInventory.length
    ? canonicalDeliveryInventory.map((row) => ({
        label: localizedExpectationText(row.functionLabel || "", 200),
        detail: row.subfunctionId ? localizedExpectationText(row.subfunctionLabel || "", 240) : "",
        deadline: localizedExpectationText(row.deadline || row.phase || "", 80),
        // The amount remains on the unexpanded commercial inventory; this
        // placeholder only keeps the text expectation row structurally valid.
        amountMinor: 0,
      }))
    : commercialFunctionRows.flatMap((row) => {
        const terminalDetails = decomposeProductMapDetail(row.detail || "");
        if (!terminalDetails.length) return [row];
        return terminalDetails.map((detail) => ({ ...row, detail: localizedExpectationText(detail, 240) }));
      });
  const payments = lock
    ? (lock.payments || []).map((row) => ({
        label: localizedExpectationText(row.name, 200),
        amountMinor: Number(row.amountMinor),
        percentBasisPoints: Number(row.percentBasisPoints),
      }))
    : (proposalModel?.payments || []).map((row) => ({
        label: localizedExpectationText(row.name || row.label || "", 200),
        amountMinor: majorToMinorForExpectation(row.amount ?? row.total, exponent),
        percentBasisPoints: Math.round(Number(row.percent ?? row.percentage ?? 0) * 100),
      }));
  const functionSubtotalMinor = lock
    ? Number(lock.functionPriceSubtotalMinor)
    : commercialFunctionRows.reduce((sum, row) => sum + (Number.isSafeInteger(row.amountMinor) ? row.amountMinor : 0), 0);
  const durationMonths = Number(lock?.durationMonths ?? proposalModel?.durationMonths ?? 0);
  const durationWeeks = Number(lock?.durationWeeks ?? proposalModel?.durationWeeks ?? 0);
  const coverage = buildExpectationCoverage({
    presentationPlan,
    plannedPages,
    expectedPageCount: resolvedExpectedPageCount,
    commercialLock: lock,
    pageIdentities,
  });
  return {
    mode,
    expectedPageCount: resolvedExpectedPageCount,
    coverage,
    projectName: safeExpectationText(proposalModel?.title || proposalModel?.projectName || "", 200),
    pageTitles,
    pageByKind,
    pagesByKind,
    pageIdentities,
    minTextByPage: mode === "v5" ? Object.fromEntries(plannedPages.map((page) => [page.pageNumber, V5_MIN_TEXT_BY_KIND[page.kind] || 70])) : {},
    commercial: {
      currency,
      currencyStatus,
      currencyExponent: exponent,
      projectPriceMinor: safeNonNegativeInteger(projectPriceMinor),
      briefBudgetMinor: safeNonNegativeInteger(briefBudgetMinor),
      functionSubtotalMinor: safeNonNegativeInteger(functionSubtotalMinor),
      functionRows: functionRows.filter(validCommercialExpectationRow),
      payments: payments.filter((row) => validCommercialExpectationRow(row) && Number.isInteger(row.percentBasisPoints) && row.percentBasisPoints >= 0),
    },
    roadmap: {
      durationMonths: Number.isFinite(durationMonths) && durationMonths > 0 ? durationMonths : null,
      durationWeeks: Number.isFinite(durationWeeks) && durationWeeks > 0 ? durationWeeks : null,
      workstreams: canonicalDeliveryInventory.length
        ? canonicalDeliveryInventory.map((row) => localizedExpectationText(row.subfunctionLabel || row.functionLabel || "", 240)).filter(Boolean)
        : functionRows.map((row) => row.detail || row.label).filter(Boolean),
    },
    team: {
      truthStatus: String(lock?.teamPlan?.truthStatus || proposalModel?.teamPlan?.truthStatus || "unknown").toLowerCase(),
      people: ["explicit", "verified"].includes(String(lock?.teamPlan?.truthStatus || proposalModel?.teamPlan?.truthStatus || "").toLowerCase())
        ? safeNonNegativeInteger(Number(lock?.teamPlan?.people ?? proposalModel?.teamPlan?.people ?? 0))
        : null,
      fteMonths: safeNonNegativeNumber(lock?.teamPlan?.fteMonths ?? proposalModel?.teamPlan?.fteMonths),
      roles: (lock?.teamPlan?.roles || proposalModel?.teamPlan?.roles || [])
        .map((value) => localizedExpectationText(value?.role || value, 160))
        .filter(Boolean),
    },
    close: {
      decisions: (closeCta.decisions || []).map((value) => safeExpectationText(value?.label || value, 200)).filter(Boolean),
      owners: (closeCta.owners || []).map((value) => safeExpectationText(value?.label || value, 200)).filter(Boolean),
      nextAction: safeExpectationText(closeCta.nextAction || "", 320),
    },
  };
}

function buildExpectationCoverage({ presentationPlan, plannedPages, expectedPageCount, commercialLock, pageIdentities }) {
  const pageNumbers = plannedPages.map((page) => Number(page?.pageNumber));
  const pageNumberSet = new Set(pageNumbers);
  const expectedSequence = Number.isInteger(expectedPageCount) && expectedPageCount > 0
    ? Array.from({ length: expectedPageCount }, (_, index) => index + 1)
    : [];
  const planPresent = Boolean(presentationPlan && plannedPages.length);
  const expectedPageCountPresent = Number.isInteger(expectedPageCount) && expectedPageCount > 0;
  const pageMappingComplete = planPresent
    && expectedPageCountPresent
    && plannedPages.length === expectedPageCount
    && pageNumberSet.size === plannedPages.length
    && expectedSequence.every((pageNumber) => pageNumberSet.has(pageNumber))
    && plannedPages.every((page) => typeof page?.kind === "string" && page.kind.trim());
  const commercialKinds = new Set(["function_price", "project_price", "payments"]);
  const commercialContextRequired = plannedPages.some((page) => commercialKinds.has(page?.kind));
  const commercialLockPresent = !commercialContextRequired || hasCompleteCommercialLock(commercialLock, plannedPages);
  const domInventoryPresent = plannedPages.length > 0
    && pageIdentities.length === plannedPages.length
    && pageIdentities.every((row) => Number.isInteger(row.page) && row.visibleTitle && Array.isArray(row.visibleTokens) && row.visibleTokens.length > 0);
  const complete = planPresent && expectedPageCountPresent && pageMappingComplete && commercialLockPresent;
  return {
    planPresent,
    expectedPageCountPresent,
    expectedPageCountMatchesPlan: expectedPageCountPresent && plannedPages.length === expectedPageCount,
    pageMappingComplete,
    commercialContextRequired,
    commercialLockPresent,
    domInventoryPresent,
    complete,
    fullContextComplete: complete && domInventoryPresent,
  };
}

function hasCompleteCommercialLock(lock, plannedPages) {
  if (!lock || typeof lock !== "object" || typeof lock.lockHash !== "string" || !lock.lockHash.trim()) return false;
  const kinds = new Set(plannedPages.map((page) => page?.kind));
  const hasProjectTotal = Number.isSafeInteger(Number(lock.projectPriceMinor)) && Number(lock.projectPriceMinor) >= 0;
  if ((kinds.has("project_price") || kinds.has("payments")) && !hasProjectTotal) return false;
  if (kinds.has("function_price")) {
    const rows = Array.isArray(lock.functionPrice) ? lock.functionPrice : [];
    if (!rows.length || !rows.every((row) => validCommercialExpectationRow({
      label: row?.name,
      amountMinor: Number(row?.amountMinor),
    }))) return false;
    if (!Number.isSafeInteger(Number(lock.functionPriceSubtotalMinor)) || Number(lock.functionPriceSubtotalMinor) < 0) return false;
  }
  if (kinds.has("payments")) {
    const rows = Array.isArray(lock.payments) ? lock.payments : [];
    // A requested payments page may intentionally remain pending while the
    // project price is unknown. Without any reconciliation basis an empty
    // locked inventory is the only safe context: fabricating milestone amounts
    // would turn the client's budget into a quote. A positive paymentBasisMinor
    // (the client's explicitly stated budget) sanctions a disclosed planning
    // schedule; then, as with a positive project price, fail closed unless
    // every payment row is present and fully reconcilable.
    const paymentBasisMinor = Number(lock.pricing?.paymentBasisMinor) > 0
      ? Number(lock.pricing.paymentBasisMinor)
      : Number(lock.projectPriceMinor);
    if (paymentBasisMinor === 0) return rows.length === 0;
    if (!rows.length || !rows.every((row) => validCommercialExpectationRow({
      label: row?.name,
      amountMinor: Number(row?.amountMinor),
    }) && Number.isInteger(Number(row?.percentBasisPoints)) && Number(row.percentBasisPoints) >= 0)) return false;
  }
  return true;
}

function safeExpectationText(value, maxLength) {
  return String(value || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeExpectationToken(value) {
  const token = String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return token.length >= 2 && token.length <= 80 ? token : "";
}

function majorToMinorForExpectation(value, exponent) {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  if (!/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > exponent) return null;
  const minor = (BigInt(whole) * (10n ** BigInt(exponent))) + BigInt((fraction + "0".repeat(exponent)).slice(0, exponent) || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function validCommercialExpectationRow(row) {
  return Boolean(row?.label) && Number.isSafeInteger(row?.amountMinor) && row.amountMinor >= 0;
}

function usage() {
  return [
    "Usage: node scripts/kp_pdf_visual_qa.mjs <pdf-path> [output-dir]",
    "       node scripts/kp_pdf_visual_qa.mjs <pdf-path> [output-dir] --json <path> --expected-pages 21 --expected-ratio 1.5 --mode legacy|v5",
    "",
    "Renders every page, creates a contact sheet, checks near-blank pages and scans",
    "extracted text for client-facing internal identifiers and cover-price leakage.",
    "Defaults: 3:2 aspect ratio and no price on the cover. Override with",
    "KP_PDF_EXPECTED_RATIO, KP_PDF_EXPECTED_PAGES or KP_PDF_ALLOW_COVER_PRICE=1.",
    "",
    "Exit codes: 0 = pass, 2 = hard QA defects, 1 = execution/configuration error.",
  ].join("\n");
}

function slugify(value = "kp-pdf") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "kp-pdf";
}

function executableOnPath(name) {
  if (!name) return "";
  if (path.isAbsolute(name) || name.includes(path.sep)) {
    return fsSync.existsSync(name) ? name : "";
  }
  for (const directory of String(process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}

function resolvePopplerBinary(name) {
  const envName = name.toUpperCase();
  const candidates = [
    process.env[envName],
    executableOnPath(name),
    path.join(BUNDLED_DEPENDENCIES, "native", "poppler", "bin", name),
    path.join(BUNDLED_DEPENDENCIES, "native", "poppler", "poppler", "bin", name),
    path.join(BUNDLED_DEPENDENCIES, "bin", "override", name),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`${name} topilmadi. Poppler o'rnating yoki ${envName} orqali absolute path bering.`);
}

function pythonSupportsQa(python) {
  const result = spawnSync(python, ["-c", "import PIL, pdfplumber, pypdf"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0;
}

function resolvePython() {
  const candidates = [
    process.env.CODEX_PYTHON,
    path.join(BUNDLED_DEPENDENCIES, "python", "bin", "python3"),
    executableOnPath("python3"),
    executableOnPath("python"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (pythonSupportsQa(candidate)) return candidate;
  }
  throw new Error("Pillow va pypdf mavjud Python topilmadi. CODEX_PYTHON orqali runtime path bering.");
}

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${path.basename(command)} failed with exit ${result.status}${details ? `: ${details}` : ""}`);
  }
  return result;
}

const PYTHON_QA_SCRIPT = String.raw`
import glob
import json
import math
import os
import re
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont, ImageStat
import pdfplumber
from pypdf import PdfReader

pdf_path = os.path.abspath(sys.argv[1])
render_dir = os.path.abspath(sys.argv[2])
contact_sheet_path = os.path.abspath(sys.argv[3])
expected_ratio = float(sys.argv[4])
expected_page_count = int(sys.argv[5])
forbid_cover_price = sys.argv[6] == "1"
mode = sys.argv[7] if len(sys.argv) > 7 else "v5"
expectations_path = os.path.abspath(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] else None
require_full_context = len(sys.argv) > 9 and sys.argv[9] == "1"
expectations = {}
if expectations_path and os.path.isfile(expectations_path):
    with open(expectations_path, "r", encoding="utf-8") as handle:
        expectations = json.load(handle)

def natural_key(value):
    name = os.path.basename(value)
    match = re.search(r"(\d+)(?=\.png$)", name, re.I)
    return int(match.group(1)) if match else 10**9

png_paths = sorted(glob.glob(os.path.join(render_dir, "page-*.png")), key=natural_key)
if not png_paths:
    raise RuntimeError("Poppler rendered no page PNG files")

reader = PdfReader(pdf_path)
pdf_page_count = len(reader.pages)
page_texts = []
page_label_positions = []
for page_index, pdf_page in enumerate(reader.pages):
    positions = []
    page_width_points = float(pdf_page.mediabox.width)
    page_height_points = float(pdf_page.mediabox.height)
    expected_label = re.compile(rf"^0?{page_index + 1}\s*(?:/|of|из)\s*0?{max(1, expected_page_count or pdf_page_count)}$", re.I)
    def visit_text(text, cm, tm, font_dict, font_size):
        candidate = re.sub(r"\s+", " ", (text or "")).strip()
        if candidate and expected_label.match(candidate):
            # Chromium PDFs may expose a page-level CM while leaving TM at the
            # origin for CSS-positioned text.  Those coordinates are not a
            # usable label bounding box and must not become a false "clipped"
            # result.  When TM does carry a translation, transform it into PDF
            # user space before comparing it with the MediaBox.
            tm_x = float(tm[4])
            tm_y = float(tm[5])
            coordinate_reliable = abs(tm_x) > 0.001 or abs(tm_y) > 0.001
            x = (tm_x * float(cm[0])) + (tm_y * float(cm[2])) + float(cm[4]) if coordinate_reliable else 0.0
            y = (tm_x * float(cm[1])) + (tm_y * float(cm[3])) + float(cm[5]) if coordinate_reliable else 0.0
            positions.append({
                "x": x,
                "y": y,
                "fontSize": float(font_size or 0),
                "coordinateReliable": coordinate_reliable,
                "pageWidthPoints": page_width_points,
                "pageHeightPoints": page_height_points,
            })
    extracted = (pdf_page.extract_text(visitor_text=visit_text) or "").strip()
    page_texts.append(extracted)
    page_label_positions.append(positions)

identifier_patterns = {
    "absolute_users_path": re.compile(r"/Users/[^\s<>'\"]+", re.I),
    "telegram_uri": re.compile(r"telegram://", re.I),
    "file_uri": re.compile(r"file://", re.I),
}
internal_copy_pattern = re.compile(
    r"(?:\b(?:lorem ipsum|placeholder|dummy|sample page|template page|content here|coming soon|replace me|"
    r"premium visual direction|brandbook-ready|internal note)\b|\bvalidated\s+[^\n.]{0,120}\s+page\s*[.!]?)",
    re.I,
)
cover_price_pattern = re.compile(
    r"(?:\bUSD\b|US\$|\$)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?",
    re.I,
)

def normalize_visible_text(value):
    value = unicodedata.normalize("NFKC", value or "").casefold()
    # Russian copy may legitimately use either е or ё (for example
    # "партнер"/"партнёр"). Treat them as the same grapheme for semantic
    # presence checks so typography cannot create a false missing-content
    # blocker.
    value = value.replace("ё", "е")
    value = re.sub(r"[^\w%$]+", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()

def compact_money_text(value):
    return re.sub(r"[\s,._'’]", "", unicodedata.normalize("NFKC", value or "").upper())

def contains_phrase(text, phrase):
    target = normalize_visible_text(phrase)
    return bool(target) and target in normalize_visible_text(text)

def title_identity_match(text, title):
    normalized_text = normalize_visible_text(text)
    normalized_title = normalize_visible_text(title)
    title_tokens = re.findall(r"[^\W_]+", normalized_title, flags=re.UNICODE)
    if not title_tokens:
        return False, {"coverageRatio": 0.0, "matchedTokenCount": 0, "expectedTokenCount": 0}
    compact_text = re.sub(r"\s+", "", normalized_text)
    compact_title = "".join(title_tokens)
    if compact_title and compact_title in compact_text:
        return True, {
            "coverageRatio": 1.0,
            "matchedTokenCount": len(title_tokens),
            "expectedTokenCount": len(title_tokens),
            "compactSequenceMatched": True,
        }
    cursor = 0
    positions = []
    missing = []
    for token in title_tokens:
        position = normalized_text.find(token, cursor)
        if position < 0:
            missing.append(token)
            continue
        positions.append((position, position + len(token)))
        cursor = position + len(token)
    coverage_ratio = len(positions) / len(title_tokens)
    span_length = positions[-1][1] - positions[0][0] if positions else 0
    maximum_span = max(24, int(len(normalized_title) * 1.25) + 12)
    matched = coverage_ratio >= 0.95 and span_length <= maximum_span
    return matched, {
        "coverageRatio": round(coverage_ratio, 4),
        "matchedTokenCount": len(positions),
        "expectedTokenCount": len(title_tokens),
        "spanLength": span_length,
        "maximumSpan": maximum_span,
        "missingTokens": missing[:12],
        "compactSequenceMatched": False,
    }

def contains_any(text, alternatives):
    normalized = normalize_visible_text(text)
    return any(normalize_visible_text(value) in normalized for value in alternatives if normalize_visible_text(value))

def decimal_text_from_minor(minor, exponent):
    if not isinstance(minor, int) or minor < 0 or not isinstance(exponent, int) or exponent < 0:
        return None
    digits = str(minor)
    if exponent == 0:
        return digits
    digits = digits.rjust(exponent + 1, "0")
    fraction = digits[-exponent:]
    whole = digits[:-exponent]
    if set(fraction) == {"0"}:
        return whole
    return whole + "." + fraction.rstrip("0")

def amount_numeric_pattern(amount_minor, exponent):
    amount = decimal_text_from_minor(amount_minor, exponent)
    if amount is None:
        return None
    whole, dot, fraction = amount.partition(".")
    grouped_parts = []
    first_group = len(whole) % 3 or 3
    grouped_parts.append(re.escape(whole[:first_group]))
    for offset in range(first_group, len(whole), 3):
        grouped_parts.append(r"[\s,.'’]")
        grouped_parts.append(re.escape(whole[offset:offset + 3]))
    grouped_whole = "".join(grouped_parts)
    whole_pattern = re.escape(whole)
    if len(whole) > 3:
        whole_pattern = rf"(?:{whole_pattern}|{grouped_whole})"
    if dot:
        trimmed = fraction.rstrip("0") or "0"
        fraction_pattern = re.escape(trimmed)
        if trimmed != fraction:
            fraction_pattern = rf"(?:{fraction_pattern}|{re.escape(fraction)})"
        decimal_pattern = rf"[.,]{fraction_pattern}"
    elif exponent > 0:
        decimal_pattern = rf"(?:[.,]0{{{exponent}}})?"
    else:
        decimal_pattern = ""
    return rf"(?<!\d){whole_pattern}{decimal_pattern}(?!\d)"

def contains_amount(text, amount_minor, exponent):
    numeric_pattern = amount_numeric_pattern(amount_minor, exponent)
    if not numeric_pattern:
        return False
    return bool(re.search(numeric_pattern, unicodedata.normalize("NFKC", text or ""), re.I))

def explicit_brief_budget_on_cover(page_texts, expectations):
    if not page_texts or not isinstance(expectations, dict):
        return False
    commercial = expectations.get("commercial") or {}
    amount_minor = commercial.get("briefBudgetMinor")
    exponent = commercial.get("currencyExponent") if isinstance(commercial.get("currencyExponent"), int) else 2
    return (
        isinstance(amount_minor, int)
        and amount_minor > 0
        and contains_amount(page_texts[0], amount_minor, exponent)
        and contains_any(page_texts[0], [
            "budget from brief", "client budget", "brief budget",
            "бюджет из брифа", "бюджет клиента",
            "brifdagi budjet", "mijoz budjeti",
        ])
    )

def contains_money(text, currency, amount_minor, exponent):
    numeric_pattern = amount_numeric_pattern(amount_minor, exponent)
    if not numeric_pattern:
        return False
    code = re.sub(r"[^A-Z]", "", str(currency or "").upper())
    symbols = {"USD": "$", "EUR": "€", "GBP": "£"}
    markers = []
    if code:
        markers.append(rf"(?<![A-Z]){re.escape(code)}(?![A-Z])")
    if symbols.get(code):
        markers.append(re.escape(symbols[code]))
    if not markers:
        return False
    marker_pattern = rf"(?:{'|'.join(markers)})"
    normalized = unicodedata.normalize("NFKC", text or "")
    return bool(re.search(
        rf"(?:{marker_pattern}[\s:]*(?:{numeric_pattern})|(?:{numeric_pattern})[\s:]*(?:{marker_pattern}))",
        normalized,
        re.I,
    ))

def contains_currency_confirmation(text):
    return contains_any(text, [
        "currency to confirm", "confirm currency", "currency not supplied", "currency not provided",
        "валюту подтверд", "валюта требует подтверж", "валюта не предостав", "валюта не указан", "уточнить валют",
        "valyutani tasdiqlash", "valyuta tasdiq", "valyuta taqdim etilmagan", "valyuta ko rsatilmagan",
    ])

def contains_planning_assumption(text):
    return contains_any(text, [
        "planning scenario", "assumption", "requires confirmation", "to confirm",
        "плановый сценарий", "допущение", "требует подтверждения", "нужно подтвердить",
        "rejalashtirish ssenariysi", "taxmin", "tasdiqlash kerak", "tasdiqlanishi kerak",
    ])

def contains_unknown_currency_token(text):
    return bool(re.search(r"(?<![A-Z])XXX(?![A-Z])", unicodedata.normalize("NFKC", text or "").upper()))

def commercial_amount_is_visible(text, currency, currency_status, amount_minor, exponent):
    status = str(currency_status or "").lower()
    code = re.sub(r"[^A-Z]", "", str(currency or "").upper())
    if code == "XXX" or status == "unknown":
        return contains_amount(text, amount_minor, exponent) and contains_currency_confirmation(text) and not contains_unknown_currency_token(text)
    if status == "assumed":
        return contains_money(text, code, amount_minor, exponent) and (contains_currency_confirmation(text) or contains_planning_assumption(text))
    return contains_money(text, code, amount_minor, exponent)

def contains_number_value(text, value):
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return False
    raw = f"{value:g}"
    whole, dot, fraction = raw.partition(".")
    decimal = rf"[.,]{re.escape(fraction)}" if dot else ""
    return bool(re.search(rf"(?<!\d){re.escape(whole)}{decimal}(?!\d)", unicodedata.normalize("NFKC", text or "")))

def contains_percent(text, basis_points):
    if not isinstance(basis_points, int) or basis_points < 0:
        return False
    whole = basis_points // 100
    fraction = basis_points % 100
    variants = {f"{whole}%", f"{whole}.00%"}
    if fraction:
        variants.add(f"{whole}.{fraction:02d}%")
    compact = compact_money_text(text)
    return any(compact_money_text(value) in compact for value in variants)

def add_required_text_defect(hard_defects, page, requirement, message, evidence=None):
    row = {
        "code": "required_text_missing",
        "page": page,
        "requirement": requirement,
        "message": message,
    }
    if evidence:
        row["evidence"] = evidence
    hard_defects.append(row)

def inspect_v5_story_content(page_texts, hard_defects, expectations):
    page_by_kind = expectations.get("pageByKind") or {}
    pages_by_kind = expectations.get("pagesByKind") or {}

    def planned_page(kind):
        value = page_by_kind.get(kind)
        return value if isinstance(value, int) and 1 <= value <= len(page_texts) else None

    def planned_pages(kind):
        values = pages_by_kind.get(kind) or []
        normalized = [value for value in values if isinstance(value, int) and 1 <= value <= len(page_texts)]
        if normalized:
            return normalized
        value = planned_page(kind)
        return [value] if value else []

    # Semantic payload markers apply only when that page is part of the adaptive
    # story. Russian and Uzbek stems keep localized output fail-closed.
    groups = {
        "launch_boundary": [
            ["owned", "own", "владение", "собственн", "o zimiz", "egalik", "ichki boshqaruv", "mas uliyat modeli"],
            ["partner", "integrat", "партнер", "интеграц", "hamkor", "integrats"],
            ["defer", "out of scope", "отлож", "вне объема", "keyin", "doiradan tashqari"],
        ],
        "architecture": [
            ["trusted", "trust boundary", "доверенн", "граница доверия", "ishonch"],
            ["data", "database", "данн", "ma lumot"],
            ["external", "partner", "внешн", "партнер", "tashqi", "hamkor"],
        ],
        "client_dependencies": [
            ["client dependenc", "required from client", "client input", "от клиента", "зависимост", "данные клиента", "mijozdan", "mijoz ma lumot", "bog liqlik"],
            ["access", "integration", "approval", "owner", "доступ", "интеграц", "согласов", "ответствен", "kirish", "integrats", "tasdiq", "mas ul", "egasi"],
            ["required", "to confirm", "provided", "in progress", "status", "требуется", "подтверд", "предоставл", "в работе", "статус", "kerak", "tasdiqlash", "taqdim etilgan", "jarayonda", "holat"],
        ],
        "function_price": [
            ["functional block", "функциональ", "funksional blok"],
            ["main task", "основная задача", "asosiy vazifa"],
            ["subtask", "подзадача", "quyi vazifa"],
            ["deadline", "week", "срок", "недел", "muddat", "hafta"],
        ],
        "swot": [
            ["strength", "сильн", "kuchli"],
            ["weakness", "слаб", "zaif"],
            ["opportunity", "возможност", "imkon"],
            ["threat", "угроз", "tahdid", "xatar"],
        ],
        "roadmap": [["week", "month", "milestone", "gate", "date", "недел", "месяц", "этап", "дата", "hafta", "oy", "bosqich", "sana"]],
        "close": [
            ["decision", "решени", "qaror"],
            ["owner", "ответствен", "владел", "mas ul", "egasi"],
            ["next action", "next step", "следующ", "дальше", "keyingi", "navbatdagi"],
        ],
    }
    for kind, required_groups in groups.items():
        page_number = planned_page(kind)
        if not page_number:
            continue
        text = page_texts[page_number - 1]
        for group_index, alternatives in enumerate(required_groups, 1):
            if not contains_any(text, alternatives):
                add_required_text_defect(hard_defects, page_number, f"story_{kind}_group_{group_index}", f"Page {page_number} is missing required {kind} content")

    for flow_page in planned_pages("primary_flow"):
        flow_text = page_texts[flow_page - 1]
        question_variant = contains_any(flow_text, ["process questions", "workflow questions", "вопросы процесса", "вопросы по процессу", "jarayon savollari"])
        connected_variant = (
            contains_any(flow_text, ["start", "received order", "outcome received", "delivery outcome", "начало", "начат", "старт", "получил заказ", "итог доставки", "boshlanish", "boshla", "boshlan", "buyurtmani oldi", "natijasi olindi"])
            and contains_any(flow_text, ["end", "outcome", "handed", "stopped", "конец", "результат", "заверш", "оконч", "передан", "останов", "yakun", "natija", "yuboril"])
            and contains_any(flow_text, ["task", "decision", "gateway", "actor", "задач", "решени", "роль", "vazifa", "qaror", "ishtirokchi"])
        )
        if not question_variant and not connected_variant:
            add_required_text_defect(hard_defects, flow_page, "primary_flow_payload", f"Page {flow_page} must contain a connected process or an explicit Process questions fallback")

    market_page = planned_page("market_sizing")
    if market_page:
        market_text = page_texts[market_page - 1]
        market_numeric = all(contains_any(market_text, [label]) for label in ["tam", "sam", "som"])
        market_pending = contains_any(market_text, ["formula", "to confirm", "methodology", "формул", "уточн", "методолог", "tasdiqlash"])
        if not market_numeric and not market_pending:
            add_required_text_defect(hard_defects, market_page, "market_sizing_payload", f"Page {market_page} must contain TAM/SAM/SOM logic or an honest formula-pending state")

def inspect_dynamic_expectations(page_texts, hard_defects, expectations):
    if not page_texts:
        return
    page_by_kind = expectations.get("pageByKind") or {}
    pages_by_kind = expectations.get("pagesByKind") or {}

    def page_numbers(kind):
        values = pages_by_kind.get(kind) or []
        normalized = [value for value in values if isinstance(value, int) and 1 <= value <= len(page_texts)]
        if normalized:
            return normalized
        value = page_by_kind.get(kind)
        return [value] if isinstance(value, int) and 1 <= value <= len(page_texts) else []

    def page_number(kind):
        values = page_numbers(kind)
        return values[0] if values else None

    def page_text(kind):
        return "\n".join(page_texts[value - 1] for value in page_numbers(kind))
    project_name = expectations.get("projectName") or ""
    if project_name and not contains_phrase(page_texts[0], project_name):
        add_required_text_defect(
            hard_defects,
            1,
            "project_identity",
            "Cover does not contain the exact project identity",
            {"expectedLength": len(project_name)},
        )

    for row in expectations.get("pageTitles") or []:
        title_page_number = row.get("page")
        title = row.get("title") or ""
        if isinstance(title_page_number, int) and 1 <= title_page_number <= len(page_texts) and title and not contains_phrase(page_texts[title_page_number - 1], title):
            add_required_text_defect(hard_defects, title_page_number, "planned_page_title", f"Page {title_page_number} does not contain its planned title")

    for row in expectations.get("pageIdentities") or []:
        identity_page_number = row.get("page")
        if not isinstance(identity_page_number, int) or not 1 <= identity_page_number <= len(page_texts):
            continue
        identity_text = page_texts[identity_page_number - 1]
        visible_title = row.get("visibleTitle") or ""
        title_matches, title_evidence = title_identity_match(identity_text, visible_title) if visible_title else (True, {})
        if visible_title and not title_matches:
            hard_defects.append({
                "code": "page_kind_identity_mismatch",
                "page": identity_page_number,
                "message": f"Page {identity_page_number} does not contain its exact DOM-visible title",
                "evidence": {"kind": row.get("kind") or "", "title": visible_title[:160], **title_evidence},
            })
        tokens = [normalize_visible_text(value) for value in (row.get("visibleTokens") or [])]
        tokens = list(dict.fromkeys(value for value in tokens if len(value) >= 2))
        if tokens:
            normalized_pdf_text = normalize_visible_text(identity_text)
            matched = [token for token in tokens if token in normalized_pdf_text]
            coverage_ratio = len(matched) / len(tokens)
            if coverage_ratio < 0.85:
                missing = [token for token in tokens if token not in normalized_pdf_text]
                hard_defects.append({
                    "code": "dom_token_coverage_low",
                    "page": identity_page_number,
                    "message": f"Page {identity_page_number} preserves only {coverage_ratio:.1%} of its DOM text-token inventory",
                    "evidence": {
                        "kind": row.get("kind") or "",
                        "matchedTokenCount": len(matched),
                        "expectedTokenCount": len(tokens),
                        "coverageRatio": round(coverage_ratio, 4),
                        "missingTokens": missing[:20],
                    },
                })

    commercial = expectations.get("commercial") or {}
    currency = commercial.get("currency") or "USD"
    currency_status = str(commercial.get("currencyStatus") or ("unknown" if currency == "XXX" else "explicit")).lower()
    exponent = commercial.get("currencyExponent") if isinstance(commercial.get("currencyExponent"), int) else 2
    project_price_minor = commercial.get("projectPriceMinor")
    brief_budget_minor = commercial.get("briefBudgetMinor")
    function_subtotal_minor = commercial.get("functionSubtotalMinor")
    cover_has_explicit_brief_budget = explicit_brief_budget_on_cover(page_texts, expectations)
    locked_amount_is_labeled_budget = (
        cover_has_explicit_brief_budget
        and brief_budget_minor == project_price_minor
    )
    if forbid_cover_price and isinstance(project_price_minor, int) and project_price_minor > 0 and contains_amount(page_texts[0], project_price_minor, exponent) and not locked_amount_is_labeled_budget:
        hard_defects.append({
            "code": "cover_price_leak",
            "page": 1,
            "message": "Cover contains the exact locked project amount",
        })
    # The cover is deliberately commercial-free: the client budget is an input
    # constraint and must not be displayed as a hero metric.
    if isinstance(brief_budget_minor, int) and brief_budget_minor > 0 and contains_amount(page_texts[0], brief_budget_minor, exponent):
        hard_defects.append({
            "code": "cover_budget_leak",
            "page": 1,
            "message": "Cover must not display the client budget amount",
        })
    if currency == "XXX" or currency_status == "unknown":
        for kind in ["function_price", "project_price", "payments"]:
            commercial_page = page_number(kind)
            if commercial_page and contains_unknown_currency_token(page_texts[commercial_page - 1]):
                hard_defects.append({
                    "code": "unknown_currency_token_visible",
                    "page": commercial_page,
                    "message": "Unknown ISO placeholder XXX is visible to the client",
                })
    project_price_page = page_number("project_price")
    if project_price_page and isinstance(project_price_minor, int) and project_price_minor > 0:
        if not commercial_amount_is_visible(page_text("project_price"), currency, currency_status, project_price_minor, exponent):
            add_required_text_defect(hard_defects, project_price_page, "project_price_total", f"Page {project_price_page} does not contain the locked project total with the required currency truth marker")
    function_price_page = page_number("function_price")
    if function_price_page:
        for index, row in enumerate(commercial.get("functionRows") or []):
            label = row.get("label") or ""
            label_ok = contains_phrase(page_text("function_price"), label)
            detail = row.get("detail") or ""
            deadline = row.get("deadline") or ""
            detail_ok = not detail or contains_phrase(page_text("function_price"), detail)
            deadline_ok = not deadline or contains_phrase(page_text("function_price"), deadline)
            if not label_ok or not detail_ok or not deadline_ok:
                add_required_text_defect(
                    hard_defects,
                    function_price_page,
                    f"function_price_row_{index + 1}",
                    f"Page {function_price_page} is missing a locked function schedule row, subtask, or deadline",
                    {"rowIndex": index + 1, "labelPresent": label_ok, "detailPresent": detail_ok, "deadlinePresent": deadline_ok},
                )
    payments_page = page_number("payments")
    if payments_page:
        for index, row in enumerate(commercial.get("payments") or []):
            label = row.get("label") or ""
            amount_minor = row.get("amountMinor")
            basis_points = row.get("percentBasisPoints")
            label_ok = contains_phrase(page_text("payments"), label)
            amount_ok = commercial_amount_is_visible(page_text("payments"), currency, currency_status, amount_minor, exponent)
            percent_ok = contains_percent(page_text("payments"), basis_points)
            if not label_ok or not amount_ok or not percent_ok:
                add_required_text_defect(
                    hard_defects,
                    payments_page,
                    f"payment_row_{index + 1}",
                    f"Page {payments_page} is missing a locked payment label, amount, or percentage",
                    {"rowIndex": index + 1, "labelPresent": label_ok, "amountPresent": amount_ok, "percentPresent": percent_ok},
                )
        if isinstance(project_price_minor, int) and project_price_minor > 0 and not commercial_amount_is_visible(page_text("payments"), currency, currency_status, project_price_minor, exponent):
            add_required_text_defect(hard_defects, payments_page, "payment_total", f"Page {payments_page} does not contain the reconciled payment total")

    team_page = page_number("team")
    if team_page:
        team = expectations.get("team") or {}
        for index, role in enumerate(team.get("roles") or []):
            if not contains_phrase(page_text("team"), role):
                add_required_text_defect(hard_defects, team_page, f"team_role_{index + 1}", f"Page {team_page} is missing a locked team role", {"rowIndex": index + 1})
        people = team.get("people")
        if isinstance(people, int) and people > 0 and not re.search(rf"(?<!\d){people}(?!\d)", page_text("team")):
            add_required_text_defect(hard_defects, team_page, "team_people", f"Page {team_page} is missing the locked team-size value")
        fte_months = team.get("fteMonths")
        if isinstance(fte_months, (int, float)) and fte_months > 0 and not contains_number_value(page_text("team"), fte_months):
            add_required_text_defect(hard_defects, team_page, "team_fte_months", f"Page {team_page} is missing the locked FTE-month value")

    roadmap_page = page_number("roadmap")
    if roadmap_page:
        roadmap = expectations.get("roadmap") or {}
        months = roadmap.get("durationMonths")
        weeks = roadmap.get("durationWeeks")
        duration_markers = []
        if isinstance(months, (int, float)) and months > 0:
            duration_markers.extend([f"{months:g} month", f"{months:g} месяц", f"{months:g} oy"])
        if isinstance(weeks, (int, float)) and weeks > 0:
            duration_markers.extend([f"{weeks:g} week", f"{weeks:g} недел", f"{weeks:g} hafta"])
        if duration_markers and not contains_any(page_text("roadmap"), duration_markers):
            add_required_text_defect(hard_defects, roadmap_page, "roadmap_duration", f"Page {roadmap_page} does not contain the locked roadmap duration/scale")
        for index, workstream in enumerate(roadmap.get("workstreams") or []):
            if not contains_phrase(page_text("roadmap"), workstream):
                add_required_text_defect(hard_defects, roadmap_page, f"roadmap_workstream_{index + 1}", "Roadmap continuation pages are missing a product-map workstream", {"rowIndex": index + 1})

    close_page = page_number("close")
    if close_page:
        close = expectations.get("close") or {}
        for index, decision in enumerate(close.get("decisions") or []):
            if not contains_phrase(page_text("close"), decision):
                add_required_text_defect(hard_defects, close_page, f"close_decision_{index + 1}", f"Page {close_page} is missing a planned decision")
        for index, owner in enumerate(close.get("owners") or []):
            if not contains_phrase(page_text("close"), owner):
                add_required_text_defect(hard_defects, close_page, f"close_owner_{index + 1}", f"Page {close_page} is missing a planned owner")
        next_action = close.get("nextAction") or ""
        if next_action and not contains_phrase(page_text("close"), next_action):
            add_required_text_defect(hard_defects, close_page, "close_next_action", f"Page {close_page} is missing the planned next action")

def dereference(value):
    try:
        return value.get_object() if hasattr(value, "get_object") else value
    except Exception:
        return None

def object_identity(value):
    return (getattr(value, "idnum", None), getattr(value, "generation", None))

def inspect_text_layout(pdf_path, hard_defects):
    summaries = []
    with pdfplumber.open(pdf_path) as plumber_pdf:
        for page_index, plumber_page in enumerate(plumber_pdf.pages):
            page_number = page_index + 1
            width = float(plumber_page.width or 0)
            height = float(plumber_page.height or 0)
            out_of_bounds = []
            invalid_glyphs = []
            character_boxes = []
            for char in plumber_page.chars or []:
                glyph = str(char.get("text") or "")
                if not glyph or glyph.isspace():
                    continue
                try:
                    x0 = float(char.get("x0"))
                    x1 = float(char.get("x1"))
                    top = float(char.get("top"))
                    bottom = float(char.get("bottom"))
                except (TypeError, ValueError):
                    out_of_bounds.append({"text": glyph[:8], "reason": "non_finite_bbox"})
                    continue
                coordinates = [x0, x1, top, bottom]
                if not all(math.isfinite(value) for value in coordinates):
                    out_of_bounds.append({"text": glyph[:8], "reason": "non_finite_bbox"})
                elif x0 < -1.0 or x1 > width + 1.0 or top < -1.0 or bottom > height + 1.0 or x1 < x0 or bottom < top:
                    out_of_bounds.append({
                        "text": glyph[:8],
                        "x0": round(x0, 3), "x1": round(x1, 3),
                        "top": round(top, 3), "bottom": round(bottom, 3),
                    })
                if x1 > x0 and bottom > top and all(math.isfinite(value) for value in coordinates):
                    character_boxes.append({"text": glyph[:8], "x0": x0, "x1": x1, "top": top, "bottom": bottom})
                if any(
                    codepoint == 0xFFFD
                    or codepoint == 0
                    or (codepoint & 0xFFFF) in (0xFFFE, 0xFFFF)
                    or (unicodedata.category(character) == "Cc" and character not in "\t\n\r")
                    for character in glyph
                    for codepoint in [ord(character)]
                ):
                    invalid_glyphs.append(glyph[:16])
            if out_of_bounds:
                hard_defects.append({
                    "code": "text_bbox_out_of_bounds",
                    "page": page_number,
                    "message": f"Page {page_number} contains text outside its MediaBox",
                    "count": len(out_of_bounds),
                    "examples": out_of_bounds[:8],
                })
            extracted_text = page_texts[page_index] if page_index < len(page_texts) else ""
            for character in extracted_text:
                codepoint = ord(character)
                if (
                    codepoint == 0xFFFD
                    or codepoint == 0
                    or (codepoint & 0xFFFF) in (0xFFFE, 0xFFFF)
                    or (unicodedata.category(character) == "Cc" and character not in "\t\n\r")
                ):
                    invalid_glyphs.append(character)
            if invalid_glyphs:
                hard_defects.append({
                    "code": "invalid_glyph_visible",
                    "page": page_number,
                    "message": f"Page {page_number} contains replacement, null, or invalid glyphs",
                    "count": len(invalid_glyphs),
                    "codepoints": sorted({f"U+{ord(value[0]):04X}" for value in invalid_glyphs if value})[:12],
                })

            words = []
            try:
                words = plumber_page.extract_words(
                    x_tolerance=1.0,
                    y_tolerance=2.0,
                    keep_blank_chars=False,
                    use_text_flow=False,
                ) or []
            except Exception:
                words = []
            normalized_words = []
            for word in words:
                token = re.sub(r"\s+", " ", str(word.get("text") or "")).strip()
                if not token or not any(character.isalnum() for character in token):
                    continue
                try:
                    box = {
                        "text": token[:80],
                        "x0": float(word.get("x0")), "x1": float(word.get("x1")),
                        "top": float(word.get("top")), "bottom": float(word.get("bottom")),
                    }
                except (TypeError, ValueError):
                    continue
                if box["x1"] <= box["x0"] or box["bottom"] <= box["top"]:
                    continue
                normalized_words.append(box)
            normalized_words.sort(key=lambda row: (row["x0"], row["top"]))
            overlaps = []
            for left_index, left in enumerate(normalized_words):
                left_area = (left["x1"] - left["x0"]) * (left["bottom"] - left["top"])
                for right in normalized_words[left_index + 1:]:
                    if right["x0"] >= left["x1"] - 0.5:
                        break
                    intersection_width = min(left["x1"], right["x1"]) - max(left["x0"], right["x0"])
                    intersection_height = min(left["bottom"], right["bottom"]) - max(left["top"], right["top"])
                    if intersection_width <= 0.75 or intersection_height <= 0.75:
                        continue
                    right_area = (right["x1"] - right["x0"]) * (right["bottom"] - right["top"])
                    overlap_area = intersection_width * intersection_height
                    overlap_ratio = overlap_area / max(1.0, min(left_area, right_area))
                    vertical_ratio = intersection_height / max(1.0, min(left["bottom"] - left["top"], right["bottom"] - right["top"]))
                    if overlap_ratio >= 0.22 and vertical_ratio >= 0.35:
                        overlaps.append({
                            "left": left["text"], "right": right["text"],
                            "overlapRatio": round(overlap_ratio, 3),
                        })
                        if len(overlaps) >= 12:
                            break
                if len(overlaps) >= 12:
                    break
            # Two independently painted text runs can be merged into one
            # garbled "word" by extraction. Character-level collision checks
            # catch that case while the high overlap thresholds avoid normal
            # kerning pairs.
            if not overlaps:
                character_boxes.sort(key=lambda row: (row["x0"], row["top"]))
                for left_index, left in enumerate(character_boxes):
                    left_area = (left["x1"] - left["x0"]) * (left["bottom"] - left["top"])
                    for right in character_boxes[left_index + 1:]:
                        if right["x0"] >= left["x1"] - 0.25:
                            break
                        intersection_width = min(left["x1"], right["x1"]) - max(left["x0"], right["x0"])
                        intersection_height = min(left["bottom"], right["bottom"]) - max(left["top"], right["top"])
                        if intersection_width <= 0.5 or intersection_height <= 0.5:
                            continue
                        right_area = (right["x1"] - right["x0"]) * (right["bottom"] - right["top"])
                        overlap_ratio = (intersection_width * intersection_height) / max(1.0, min(left_area, right_area))
                        vertical_ratio = intersection_height / max(1.0, min(left["bottom"] - left["top"], right["bottom"] - right["top"]))
                        if overlap_ratio >= 0.55 and vertical_ratio >= 0.75:
                            overlaps.append({
                                "left": left["text"], "right": right["text"],
                                "overlapRatio": round(overlap_ratio, 3),
                                "granularity": "character",
                            })
                            if len(overlaps) >= 12:
                                break
                    if len(overlaps) >= 12:
                        break
            if overlaps:
                hard_defects.append({
                    "code": "serious_word_overlap",
                    "page": page_number,
                    "message": f"Page {page_number} contains materially overlapping extracted words",
                    "count": len(overlaps),
                    "examples": overlaps[:8],
                })
            summaries.append({
                "page": page_number,
                "characterCount": len(plumber_page.chars or []),
                "wordCount": len(normalized_words),
                "outOfBoundsCharacterCount": len(out_of_bounds),
                "seriousOverlapCount": len(overlaps),
                "invalidGlyphCount": len(invalid_glyphs),
            })
    return summaries

def walk_resource_objects(resources, depth=0, seen=None):
    if depth > 8:
        return
    if seen is None:
        seen = set()
    resources = dereference(resources)
    if not isinstance(resources, dict):
        return
    identity = object_identity(resources)
    if identity != (None, None):
        if identity in seen:
            return
        seen.add(identity)
    yield resources
    xobjects = dereference(resources.get("/XObject"))
    if not isinstance(xobjects, dict):
        return
    for reference in xobjects.values():
        xobject = dereference(reference)
        if isinstance(xobject, dict) and str(xobject.get("/Subtype")) == "/Form":
            yield from walk_resource_objects(xobject.get("/Resources"), depth + 1, seen)

def font_is_embedded(font):
    candidates = [font]
    descendants = dereference(font.get("/DescendantFonts")) if isinstance(font, dict) else None
    if isinstance(descendants, list):
        candidates.extend(dereference(value) for value in descendants)
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        descriptor = dereference(candidate.get("/FontDescriptor"))
        if isinstance(descriptor, dict) and any(descriptor.get(name) is not None for name in ["/FontFile", "/FontFile2", "/FontFile3"]):
            return True
    return False

def inspect_fonts_and_images(reader, hard_defects):
    font_inventory = []
    image_inventory = []
    reported_fonts = set()
    reported_images = set()
    for page_index, page in enumerate(reader.pages):
        page_number = page_index + 1
        for resources in walk_resource_objects(page.get("/Resources")):
            fonts = dereference(resources.get("/Font"))
            if isinstance(fonts, dict):
                for resource_name, reference in fonts.items():
                    font = dereference(reference)
                    if not isinstance(font, dict):
                        continue
                    identity = object_identity(reference)
                    font_key = identity if identity != (None, None) else (page_number, str(resource_name))
                    base_font = str(font.get("/BaseFont") or resource_name)
                    subtype = str(font.get("/Subtype") or "")
                    embedded = font_is_embedded(font)
                    has_to_unicode = font.get("/ToUnicode") is not None
                    if font_key not in reported_fonts:
                        font_inventory.append({
                            "page": page_number,
                            "resource": str(resource_name),
                            "baseFont": base_font,
                            "subtype": subtype,
                            "embedded": embedded,
                            "toUnicode": has_to_unicode,
                        })
                        reported_fonts.add(font_key)
                    if mode == "v5" and not embedded:
                        hard_defects.append({
                            "code": "font_not_embedded",
                            "page": page_number,
                            "message": f"Page {page_number} uses non-embedded font {base_font}",
                            "resource": str(resource_name),
                        })
                    if mode == "v5" and not has_to_unicode:
                        hard_defects.append({
                            "code": "font_tounicode_missing",
                            "page": page_number,
                            "message": f"Page {page_number} font {base_font} has no ToUnicode map",
                            "resource": str(resource_name),
                        })
            xobjects = dereference(resources.get("/XObject"))
            if not isinstance(xobjects, dict):
                continue
            for resource_name, reference in xobjects.items():
                xobject = dereference(reference)
                if not isinstance(xobject, dict) or str(xobject.get("/Subtype")) != "/Image":
                    continue
                identity = object_identity(reference)
                image_key = identity if identity != (None, None) else (page_number, str(resource_name))
                if image_key in reported_images:
                    continue
                reported_images.add(image_key)
                try:
                    width = int(xobject.get("/Width", 0) or 0)
                    height = int(xobject.get("/Height", 0) or 0)
                    bits = int(xobject.get("/BitsPerComponent", 1 if xobject.get("/ImageMask") else 0) or 0)
                except (TypeError, ValueError):
                    width, height, bits = 0, 0, 0
                image_mask = bool(xobject.get("/ImageMask", False))
                color_space = str(xobject.get("/ColorSpace") or "")
                stream_valid = True
                stream_bytes = 0
                try:
                    data = xobject.get_data()
                    stream_bytes = len(data or b"")
                    stream_valid = stream_bytes > 0
                except Exception:
                    stream_valid = False
                valid = width > 0 and height > 0 and bits in [1, 2, 4, 8, 16] and (image_mask or bool(color_space)) and stream_valid
                image_inventory.append({
                    "page": page_number,
                    "resource": str(resource_name),
                    "width": width, "height": height,
                    "bitsPerComponent": bits,
                    "colorSpace": color_space,
                    "streamBytes": stream_bytes,
                    "valid": valid,
                })
                if not valid:
                    hard_defects.append({
                        "code": "invalid_image_xobject",
                        "page": page_number,
                        "message": f"Page {page_number} contains an invalid image XObject",
                        "resource": str(resource_name),
                    })
    return font_inventory, image_inventory

def inspect_pdf_security_and_metadata(reader, hard_defects):
    findings = []
    seen_codes = set()
    def report(code, message, evidence=None):
        key = (code, message)
        if key in seen_codes:
            return
        seen_codes.add(key)
        row = {"code": code, "message": message}
        if evidence is not None:
            row["evidence"] = evidence
        hard_defects.append(row)
        findings.append(row)
    if reader.is_encrypted:
        report("pdf_encrypted", "PDF is encrypted; deterministic client review requires an unencrypted artifact")
    root = dereference(reader.trailer.get("/Root"))
    if isinstance(root, dict):
        if root.get("/OpenAction") is not None or root.get("/AA") is not None:
            report("pdf_active_content", "PDF catalog contains an automatic action")
        names = dereference(root.get("/Names"))
        if isinstance(names, dict):
            if names.get("/JavaScript") is not None:
                report("pdf_active_content", "PDF contains a JavaScript name tree")
            if names.get("/EmbeddedFiles") is not None:
                report("pdf_embedded_file", "PDF contains embedded files")
        acroform = dereference(root.get("/AcroForm"))
        if isinstance(acroform, dict):
            fields = dereference(acroform.get("/Fields"))
            if fields:
                report("pdf_interactive_form", "PDF contains interactive form fields")
    for page_index, page in enumerate(reader.pages):
        page_number = page_index + 1
        if page.get("/AA") is not None:
            report("pdf_active_content", f"Page {page_number} contains an additional action")
        annotations = dereference(page.get("/Annots"))
        if not isinstance(annotations, list):
            continue
        for annotation_reference in annotations:
            annotation = dereference(annotation_reference)
            if not isinstance(annotation, dict):
                continue
            subtype = str(annotation.get("/Subtype") or "")
            action = dereference(annotation.get("/A"))
            action_type = str(action.get("/S") or "") if isinstance(action, dict) else ""
            if subtype == "/FileAttachment":
                report("pdf_embedded_file", f"Page {page_number} contains a file attachment annotation")
            if action_type in ["/JavaScript", "/Launch", "/GoToR", "/SubmitForm", "/ImportData"]:
                report("pdf_active_content", f"Page {page_number} contains forbidden action {action_type}")
    metadata = reader.metadata or {}
    internal_metadata = []
    for key, value in metadata.items():
        text = str(value or "")
        if re.search(r"(?:/Users/|file://|telegram://)", text, re.I):
            internal_metadata.append({"key": str(key), "value": text[:160]})
    if internal_metadata:
        report("pdf_metadata_internal_identifier", "PDF metadata exposes an internal path or URI", internal_metadata)
    return findings

pages = []
hard_defects = []
warnings = []
base_dimensions = None
coverage = expectations.get("coverage") if isinstance(expectations, dict) else {}
base_context_complete = bool(isinstance(coverage, dict) and coverage.get("complete") is True)
full_context_complete = bool(isinstance(coverage, dict) and coverage.get("fullContextComplete") is True)
content_expectations_applied = full_context_complete if require_full_context else base_context_complete
if mode == "v5" and require_full_context and not content_expectations_applied:
    hard_defects.append({
        "code": "qa_context_missing",
        "message": "V5 PDF QA requires a complete presentation plan, page mapping, expected page count, and CommercialLock context for commercial pages",
        "evidence": coverage if isinstance(coverage, dict) else {},
    })
text_layout_metrics = inspect_text_layout(pdf_path, hard_defects)
font_inventory, image_inventory = inspect_fonts_and_images(reader, hard_defects)
security_findings = inspect_pdf_security_and_metadata(reader, hard_defects)
allowed_cover_budget_count = 1 if explicit_brief_budget_on_cover(page_texts, expectations) else 0

for index, image_path in enumerate(png_paths):
    page_number = index + 1
    with Image.open(image_path) as source_image:
        image = source_image.convert("RGB")
        width, height = image.size
        ratio = width / max(1, height)
        if base_dimensions is None:
            base_dimensions = (width, height)

        sample = image.copy()
        sample.thumbnail((640, 640), Image.Resampling.LANCZOS)
        gray = sample.convert("L")
        stat = ImageStat.Stat(gray)
        mean = float(stat.mean[0])
        stddev = float(stat.stddev[0])
        entropy = float(gray.entropy())
        histogram = gray.histogram()
        pixel_count = max(1, sum(histogram))
        non_white_ratio = sum(histogram[:248]) / pixel_count
        white_ratio = sum(histogram[250:]) / pixel_count

        text = page_texts[index] if index < len(page_texts) else ""
        text_length = len(text)
        internal_identifiers = [
            name for name, pattern in identifier_patterns.items() if pattern.search(text)
        ]
        internal_copy = bool(internal_copy_pattern.search(text))
        file_size = os.path.getsize(image_path)

        near_blank = (
            (white_ratio > 0.997 and stddev < 7.0 and non_white_ratio < 0.003)
            or (stddev < 1.0 and entropy < 0.12 and text_length < 20)
            or (file_size < 8000 and text_length < 20)
        )
        aspect_delta = abs(ratio - expected_ratio)
        dimension_mismatch = base_dimensions and (
            abs(width - base_dimensions[0]) > 2 or abs(height - base_dimensions[1]) > 2
        )

        if near_blank:
            hard_defects.append({
                "code": "near_blank_page",
                "page": page_number,
                "message": f"Page {page_number} has almost no visual/text signal",
            })
        if internal_identifiers:
            hard_defects.append({
                "code": "internal_identifier",
                "page": page_number,
                "types": internal_identifiers,
                "message": f"Page {page_number} exposes internal identifier(s): {', '.join(internal_identifiers)}",
            })
        if internal_copy:
            hard_defects.append({
                "code": "internal_copy",
                "page": page_number,
                "message": f"Page {page_number} exposes placeholder or production-facing copy",
            })
        cover_currency_amount_count = len(cover_price_pattern.findall(text)) if page_number == 1 else 0
        if page_number == 1 and forbid_cover_price and cover_currency_amount_count > allowed_cover_budget_count:
            hard_defects.append({
                "code": "cover_price_leak",
                "page": 1,
                "message": "Cover exposes a commercial price; cover-price policy forbids it",
            })
        if aspect_delta > 0.12:
            hard_defects.append({
                "code": "unexpected_aspect_ratio",
                "page": page_number,
                "message": f"Page {page_number} ratio {ratio:.4f} is far from expected {expected_ratio:.4f}",
            })
        elif aspect_delta > 0.035:
            warnings.append({
                "code": "aspect_ratio_warning",
                "page": page_number,
                "message": f"Page {page_number} ratio {ratio:.4f} differs from expected {expected_ratio:.4f}",
            })
        if dimension_mismatch:
            hard_defects.append({
                "code": "page_dimension_mismatch",
                "page": page_number,
                "message": f"Page {page_number} dimensions {width}x{height} differ from page 1",
            })
        page_label_found = bool(re.search(
            rf"(?:^|\s)0?{page_number}\s*(?:/|of|из)\s*0?{max(1, expected_page_count or pdf_page_count)}(?:\s|$)",
            text,
            re.I,
        ))
        page_label_clipped = False
        if mode == "v5" and not page_label_found:
            hard_defects.append({
                "code": "page_label_missing",
                "page": page_number,
                "message": f"Page {page_number} does not expose the required {page_number}/{expected_page_count or pdf_page_count} label",
            })
        elif mode == "v5" and index < len(page_label_positions) and page_label_positions[index]:
            position = page_label_positions[index][0]
            coordinate_clipped = position["coordinateReliable"] and (
                position["x"] < -0.5
                or position["x"] > position["pageWidthPoints"] + 0.5
                or position["y"] < -0.5
                or position["y"] > position["pageHeightPoints"] + 0.5
            )
            page_label_clipped = coordinate_clipped or position["fontSize"] < 7.5
            if page_label_clipped:
                hard_defects.append({
                    "code": "page_label_clipped",
                    "page": page_number,
                    "message": f"Page {page_number} label is positioned outside the readable safe area",
                    "position": position,
                })
        configured_minimum = (expectations.get("minTextByPage") or {}).get(str(page_number))
        if mode == "v5" and isinstance(configured_minimum, int) and text_length < configured_minimum:
            add_required_text_defect(
                hard_defects,
                page_number,
                "minimum_page_content",
                f"Page {page_number} has only {text_length} extracted characters; at least {configured_minimum} are required for this story page",
                {"actualCharacters": text_length, "minimumCharacters": configured_minimum},
            )
        if text_length < 40 and not near_blank:
            warnings.append({
                "code": "low_text_content",
                "page": page_number,
                "message": f"Page {page_number} has only {text_length} extracted text characters",
            })

        pages.append({
            "page": page_number,
            "image": os.path.abspath(image_path),
            "width": width,
            "height": height,
            "aspectRatio": round(ratio, 5),
            "fileSizeBytes": file_size,
            "meanLuminance": round(mean, 3),
            "stddevLuminance": round(stddev, 3),
            "entropy": round(entropy, 4),
            "nonWhiteRatio": round(non_white_ratio, 6),
            "textLength": text_length,
            "internalIdentifiers": internal_identifiers,
            "internalCopy": internal_copy,
            "nearBlank": near_blank,
            "pageLabelFound": page_label_found,
            "pageLabelClipped": page_label_clipped,
        })

if len(png_paths) != pdf_page_count:
    hard_defects.append({
        "code": "page_count_mismatch",
        "message": f"PDF has {pdf_page_count} pages but Poppler rendered {len(png_paths)}",
    })
if expected_page_count and pdf_page_count != expected_page_count:
    hard_defects.append({
        "code": "unexpected_page_count",
        "message": f"Expected {expected_page_count} pages but PDF has {pdf_page_count}",
    })

if mode == "v5":
    inspect_v5_story_content(page_texts, hard_defects, expectations)
    inspect_dynamic_expectations(page_texts, hard_defects, expectations)

with open(pdf_path, "rb") as pdf_handle:
    pdf_handle.seek(max(0, os.path.getsize(pdf_path) - 4096))
    tail = pdf_handle.read()
if b"%%EOF" not in tail or b"startxref" not in tail:
    hard_defects.append({
        "code": "file_truncated",
        "message": "PDF does not end with a complete startxref/%%EOF trailer",
    })

# A compact 3-column review wall. Metrics are intentionally short so page previews stay legible.
columns = 3
cell_width = 560
preview_height = 315
label_height = 38
gap = 24
margin = 28
rows = math.ceil(len(png_paths) / columns)
sheet_width = margin * 2 + columns * cell_width + (columns - 1) * gap
sheet_height = margin * 2 + rows * (preview_height + label_height) + max(0, rows - 1) * gap
sheet = Image.new("RGB", (sheet_width, sheet_height), "#E9EDF3")
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default(size=18)

for index, image_path in enumerate(png_paths):
    row = index // columns
    column = index % columns
    x = margin + column * (cell_width + gap)
    y = margin + row * (preview_height + label_height + gap)
    with Image.open(image_path) as source_image:
        preview = source_image.convert("RGB")
        preview.thumbnail((cell_width, preview_height), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (cell_width, preview_height), "white")
        px = (cell_width - preview.width) // 2
        py = (preview_height - preview.height) // 2
        canvas.paste(preview, (px, py))
        sheet.paste(canvas, (x, y))
    metric = pages[index]
    label = f"P{index + 1:02d}  text {metric['textLength']}  entropy {metric['entropy']:.2f}"
    draw.text((x + 4, y + preview_height + 8), label, fill="#243044", font=font)

sheet.save(contact_sheet_path, format="PNG", optimize=True)

pdf_sizes = []
for index, page in enumerate(reader.pages):
    page_number = index + 1
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    crop_width = float(page.cropbox.width)
    crop_height = float(page.cropbox.height)
    crop_left = float(page.cropbox.left)
    crop_bottom = float(page.cropbox.bottom)
    media_left = float(page.mediabox.left)
    media_bottom = float(page.mediabox.bottom)
    rotation = int(page.get("/Rotate", 0) or 0) % 360
    crop_matches = (
        abs(crop_width - width) <= 0.5
        and abs(crop_height - height) <= 0.5
        and abs(crop_left - media_left) <= 0.5
        and abs(crop_bottom - media_bottom) <= 0.5
    )
    if mode == "v5" and (abs(width - 1080.0) > 0.5 or abs(height - 720.0) > 0.5):
        hard_defects.append({
            "code": "page_size_mismatch",
            "page": page_number,
            "message": f"Page {page_number} MediaBox is {width:.3f}x{height:.3f}pt, expected 1080x720pt",
        })
    if mode == "v5" and not crop_matches:
        hard_defects.append({
            "code": "crop_box_mismatch",
            "page": page_number,
            "message": f"Page {page_number} CropBox does not match its MediaBox",
        })
    if mode == "v5" and rotation != 0:
        hard_defects.append({
            "code": "page_rotation_invalid",
            "page": page_number,
            "message": f"Page {page_number} has forbidden rotation {rotation}",
        })
    pdf_sizes.append({
        "widthPoints": round(width, 3),
        "heightPoints": round(height, 3),
        "aspectRatio": round(width / max(1.0, height), 5),
        "cropWidthPoints": round(crop_width, 3),
        "cropHeightPoints": round(crop_height, 3),
        "cropMatchesMediaBox": crop_matches,
        "rotation": rotation,
    })

print(json.dumps({
    "pdfPageCount": pdf_page_count,
    "renderedPageCount": len(png_paths),
    "pdfPageSizes": pdf_sizes,
    "mode": mode,
    "contentExpectationsApplied": content_expectations_applied,
    "expectationCoverage": coverage if isinstance(coverage, dict) else {},
    "textLayoutAudit": text_layout_metrics,
    "fontAudit": {
        "resourceCount": len(font_inventory),
        "embeddedCount": len([row for row in font_inventory if row.get("embedded")]),
        "toUnicodeCount": len([row for row in font_inventory if row.get("toUnicode")]),
        "resources": font_inventory,
    },
    "imageAudit": {
        "imageCount": len(image_inventory),
        "validImageCount": len([row for row in image_inventory if row.get("valid")]),
        "images": image_inventory,
    },
    "securityAudit": {
        "findingCount": len(security_findings),
        "encrypted": bool(reader.is_encrypted),
    },
    "pages": pages,
    "contactSheet": contact_sheet_path,
    "hardDefects": hard_defects,
    "warnings": warnings,
}, ensure_ascii=False))
`;

function conciseSummary(report) {
  const blankPages = report.pages.filter((page) => page.nearBlank).map((page) => page.page);
  const internalPages = report.pages.filter((page) => page.internalIdentifiers.length).map((page) => page.page);
  const lines = [
    `KP PDF Visual QA: ${report.status}`,
    `PDF: ${report.pdf}`,
    `Pages: ${report.renderedPageCount}/${report.pdfPageCount} rendered`,
    `Hard defects: ${report.hardDefects.length} | Warnings: ${report.warnings.length}`,
    `Near-blank pages: ${blankPages.length ? blankPages.join(", ") : "none"}`,
    `Internal identifier pages: ${internalPages.length ? internalPages.join(", ") : "none"}`,
    `Contact sheet: ${report.contactSheet}`,
    `JSON report: ${report.reportPath}`,
    "Limitation: semantic source-label collisions are not detectable; page text length is reported for review.",
  ];
  for (const defect of report.hardDefects.slice(0, 8)) lines.push(`HARD ${defect.code}${defect.page ? ` p${defect.page}` : ""}: ${defect.message}`);
  if (report.hardDefects.length > 8) lines.push(`HARD +${report.hardDefects.length - 8} more; see JSON report.`);
  for (const warning of report.warnings.slice(0, 4)) lines.push(`WARN ${warning.code}${warning.page ? ` p${warning.page}` : ""}: ${warning.message}`);
  if (report.warnings.length > 4) lines.push(`WARN +${report.warnings.length - 4} more; see JSON report.`);
  return lines.join("\n");
}

async function writeErrorArtifacts(outputDir, pdfPath, error) {
  if (!outputDir) return;
  await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
  const reportPath = path.join(outputDir, "qa-report.json");
  const summaryPath = path.join(outputDir, "qa-summary.txt");
  const report = {
    status: "ERROR",
    generatedAt: new Date().toISOString(),
    pdf: pdfPath || "",
    outputDir,
    hardDefects: [{ code: "qa_execution_error", message: error.message }],
    warnings: [],
  };
  const summary = [
    "KP PDF Visual QA: ERROR",
    `PDF: ${pdfPath || "-"}`,
    `Error: ${error.message}`,
    `JSON report: ${reportPath}`,
  ].join("\n");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8").catch(() => {});
  await fs.writeFile(summaryPath, `${summary}\n`, "utf8").catch(() => {});
}

export async function runPdfVisualQa(pdfPathInput, outputDirInput, options = {}) {
  const pdfPath = path.resolve(pdfPathInput);
  const outputDir = path.resolve(outputDirInput || path.join(
    process.cwd(),
    "tmp",
    "kp-visual-qa",
    slugify(path.basename(pdfPath, path.extname(pdfPath))),
  ));
  const stat = await fs.stat(pdfPath);
  if (!stat.isFile()) throw new Error(`PDF path file emas: ${pdfPath}`);
  if (path.extname(pdfPath).toLowerCase() !== ".pdf") throw new Error(`Input .pdf bo'lishi kerak: ${pdfPath}`);

  const pdftoppm = resolvePopplerBinary("pdftoppm");
  const python = resolvePython();
  const renderDir = path.join(outputDir, "render");
  const contactSheetPath = path.join(outputDir, "contact-sheet.png");
  const reportPath = path.join(outputDir, "qa-report.json");
  const summaryPath = path.join(outputDir, "qa-summary.txt");
  const expectationsPath = path.join(outputDir, ".content-expectations.json");
  const mode = options.mode || "legacy";
  const contentExpectations = options.contentExpectations || buildPdfContentExpectations({
    mode,
    presentationPlan: options.presentationPlan,
    proposalModel: options.proposalModel,
    semanticModel: options.semanticModel,
    commercialLock: options.commercialLock,
    expectedPageCount: options.expectedPageCount ?? EXPECTED_PAGE_COUNT ?? 0,
    domReport: options.domReport,
  });

  await fs.mkdir(outputDir, { recursive: true });
  await fs.rm(renderDir, { recursive: true, force: true });
  await fs.mkdir(renderDir, { recursive: true });

  const prefix = path.join(renderDir, "page");
  runOrThrow(pdftoppm, ["-png", "-r", String(options.dpi || DEFAULT_DPI), pdfPath, prefix], { timeout: Number(options.timeoutMs || 120_000) });

  await fs.writeFile(expectationsPath, `${JSON.stringify(contentExpectations)}\n`, { encoding: "utf8", mode: 0o600 });
  let pythonResult;
  try {
    pythonResult = runOrThrow(python, [
      "-c",
      PYTHON_QA_SCRIPT,
      pdfPath,
      renderDir,
      contactSheetPath,
      String(options.expectedAspectRatio || EXPECTED_ASPECT_RATIO),
      String(options.expectedPageCount ?? EXPECTED_PAGE_COUNT),
      (options.forbidCoverPrice ?? FORBID_COVER_PRICE) ? "1" : "0",
      mode,
      expectationsPath,
      options.requireFullContext === true ? "1" : "0",
    ], { timeout: Number(options.timeoutMs || 120_000) });
  } finally {
    await fs.rm(expectationsPath, { force: true }).catch(() => {});
  }
  const metrics = JSON.parse(pythonResult.stdout);
  const report = {
    status: metrics.hardDefects.length ? "FAIL" : "PASS",
    generatedAt: new Date().toISOString(),
    pdf: pdfPath,
    pdfSizeBytes: stat.size,
    outputDir,
    reportPath,
    summaryPath,
    render: {
      dpi: Number(options.dpi || DEFAULT_DPI),
      poppler: pdftoppm,
      python,
    },
    expectedAspectRatio: Number(options.expectedAspectRatio || EXPECTED_ASPECT_RATIO),
    mode,
    limitations: [
      "Semantic source-label collisions cannot be detected from PDF pixels/text alone.",
      "Visual statistics detect blank/structural defects; premium design quality still needs human review of the contact sheet.",
    ],
    ...metrics,
  };
  const summary = conciseSummary(report);

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(summaryPath, `${summary}\n`, "utf8");
  return report;
}

export async function inspectPdfVisualIntegrity(pdfPathInput, outputDirInput, options = {}) {
  const mode = options.mode || "v5";
  const expectedPageCountInput = Number(options.expectedPages ?? options.expectedPageCount ?? EXPECTED_PAGE_COUNT ?? 0);
  const expectedPageCount = Number.isInteger(expectedPageCountInput) && expectedPageCountInput > 0 ? expectedPageCountInput : 0;
  const expectedRatio = Number(options.expectedRatio ?? options.expectedAspectRatio ?? EXPECTED_ASPECT_RATIO);
  const report = await runPdfVisualQa(pdfPathInput, outputDirInput, {
    ...options,
    mode,
    expectedPageCount,
    expectedAspectRatio: expectedRatio,
  });
  const findings = [];
  for (const defect of report.hardDefects || []) findings.push(normalizePdfDefect(defect));
  for (const warning of report.warnings || []) findings.push({ ...normalizePdfDefect(warning), severity: "WARNING" });
  if (expectedPageCount && report.pdfPageCount !== expectedPageCount) {
    findings.push({ code: "PDF_PAGE_COUNT_MISMATCH", severity: "ERROR", message: `Expected ${expectedPageCount} pages but PDF has ${report.pdfPageCount}` });
  }
  if (report.renderedPageCount !== report.pdfPageCount) {
    findings.push({ code: "PDF_RENDER_COUNT_MISMATCH", severity: "ERROR", message: `Rendered ${report.renderedPageCount} pages for ${report.pdfPageCount}-page PDF` });
  }
  for (const [index, size] of (report.pdfPageSizes || []).entries()) {
    const page = index + 1;
    if (mode === "v5" && (Math.abs(size.widthPoints - 1080) > 0.5 || Math.abs(size.heightPoints - 720) > 0.5)) {
      findings.push({ code: "PDF_PAGE_SIZE_MISMATCH", severity: "ERROR", page, message: `Page ${page} MediaBox is ${size.widthPoints}x${size.heightPoints}pt, expected 1080x720pt` });
    }
    if (Math.abs(size.aspectRatio - expectedRatio) > 0.005) {
      findings.push({ code: "PDF_ASPECT_RATIO_INVALID", severity: "ERROR", page, message: `Page ${page} ratio ${size.aspectRatio} differs from expected ${expectedRatio}` });
    }
  }
  if (report.pdfSizeBytes < Number(options.minFileSizeBytes ?? 50 * 1024)) {
    findings.push({ code: "PDF_FILE_TOO_SMALL", severity: "ERROR", message: `PDF is ${report.pdfSizeBytes} bytes` });
  }
  const maxFileSizeBytes = Number(options.maxFileSizeBytes ?? 50 * 1024 * 1024);
  if (report.pdfSizeBytes > maxFileSizeBytes) {
    findings.push({ code: "PDF_FILE_TOO_LARGE", severity: "ERROR", message: `PDF is ${report.pdfSizeBytes} bytes` });
  }
  const pdfSha256 = await sha256File(report.pdf);
  const uniqueFindings = dedupeFindings(findings);
  const normalized = {
    status: uniqueFindings.some((finding) => ["BLOCKER", "ERROR"].includes(finding.severity)) ? "FAIL" : "PASS",
    generatedAt: report.generatedAt,
    mode,
    pdf: report.pdf,
    pdfSha256,
    pdfSizeBytes: report.pdfSizeBytes,
    outputDir: report.outputDir,
    reportPath: path.join(report.outputDir, "visual-integrity.json"),
    renderDirectory: report.render ? path.join(report.outputDir, "render") : null,
    contactSheet: report.contactSheet,
    visualIntegrityJson: path.join(report.outputDir, "visual-integrity.json"),
    pdfPageCount: report.pdfPageCount,
    renderedPageCount: report.renderedPageCount,
    pdfPageSizes: report.pdfPageSizes || [],
    pages: report.pages || [],
    contentExpectationsApplied: report.contentExpectationsApplied === true,
    expectationCoverage: report.expectationCoverage || {},
    textLayoutAudit: report.textLayoutAudit || [],
    fontAudit: report.fontAudit || {},
    imageAudit: report.imageAudit || {},
    securityAudit: report.securityAudit || {},
    findings: uniqueFindings,
    hardDefects: uniqueFindings.filter((finding) => ["BLOCKER", "ERROR"].includes(finding.severity)),
    warnings: uniqueFindings.filter((finding) => finding.severity === "WARNING"),
  };
  await fs.writeFile(normalized.visualIntegrityJson, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  if (options.jsonPath) {
    await fs.mkdir(path.dirname(path.resolve(options.jsonPath)), { recursive: true });
    await fs.writeFile(path.resolve(options.jsonPath), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }
  return normalized;
}

function normalizePdfDefect(defect = {}) {
  const map = {
    page_count_mismatch: "PDF_RENDER_COUNT_MISMATCH",
    unexpected_page_count: "PDF_PAGE_COUNT_MISMATCH",
    unexpected_aspect_ratio: "PDF_ASPECT_RATIO_INVALID",
    aspect_ratio_warning: "PDF_ASPECT_RATIO_INVALID",
    near_blank_page: "PDF_PAGE_NEAR_BLANK",
    internal_copy: "PDF_PLACEHOLDER_VISIBLE",
    internal_identifier: "CONTENT_INTERNAL_IDENTIFIER_VISIBLE",
    cover_price_leak: "PDF_COVER_PRICE_FORBIDDEN",
    unknown_currency_token_visible: "COMMERCIAL_CURRENCY_UNGROUNDED",
    page_dimension_mismatch: "PDF_RASTER_SIZE_INCONSISTENT",
    low_text_content: "PDF_TEXT_CONTENT_LOW",
    required_text_missing: "PDF_REQUIRED_TEXT_MISSING",
    page_label_missing: "PDF_PAGE_LABEL_MISSING",
    page_label_clipped: "PDF_PAGE_LABEL_MISSING",
    page_size_mismatch: "PDF_PAGE_SIZE_MISMATCH",
    crop_box_mismatch: "PDF_PAGE_SIZE_MISMATCH",
    page_rotation_invalid: "PDF_PAGE_SIZE_MISMATCH",
    file_truncated: "PDF_FILE_TRUNCATED",
    qa_context_missing: "PDF_QA_CONTEXT_MISSING",
    page_kind_identity_mismatch: "PDF_PAGE_KIND_IDENTITY_MISMATCH",
    dom_token_coverage_low: "PDF_DOM_TOKEN_COVERAGE_LOW",
    text_bbox_out_of_bounds: "PDF_TEXT_BBOX_OUT_OF_BOUNDS",
    serious_word_overlap: "PDF_TEXT_OVERLAP",
    font_not_embedded: "PDF_FONT_NOT_EMBEDDED",
    font_tounicode_missing: "PDF_FONT_TOUNICODE_MISSING",
    invalid_glyph_visible: "PDF_INVALID_GLYPH_VISIBLE",
    invalid_image_xobject: "PDF_IMAGE_XOBJECT_INVALID",
    pdf_encrypted: "PDF_SECURITY_INVALID",
    pdf_active_content: "PDF_SECURITY_INVALID",
    pdf_embedded_file: "PDF_SECURITY_INVALID",
    pdf_interactive_form: "PDF_SECURITY_INVALID",
    pdf_metadata_internal_identifier: "PDF_METADATA_INVALID",
    qa_execution_error: "PDF_PARSE_FAILED",
  };
  const code = map[defect.code] || `PDF_${String(defect.code || "DEFECT").toUpperCase()}`;
  const blockerCodes = new Set([
    "PDF_PARSE_FAILED",
    "PDF_PAGE_COUNT_MISMATCH",
    "PDF_PAGE_SIZE_MISMATCH",
    "PDF_RENDER_COUNT_MISMATCH",
    "PDF_ASPECT_RATIO_INVALID",
    "PDF_PAGE_NEAR_BLANK",
    "PDF_PLACEHOLDER_VISIBLE",
    "PDF_PAGE_LABEL_MISSING",
    "PDF_REQUIRED_TEXT_MISSING",
    "PDF_COVER_PRICE_FORBIDDEN",
    "COMMERCIAL_CURRENCY_UNGROUNDED",
    "PDF_RASTER_SIZE_INCONSISTENT",
    "PDF_FILE_TRUNCATED",
    "PDF_QA_CONTEXT_MISSING",
    "PDF_PAGE_KIND_IDENTITY_MISMATCH",
    "PDF_DOM_TOKEN_COVERAGE_LOW",
    "PDF_TEXT_BBOX_OUT_OF_BOUNDS",
    "PDF_TEXT_OVERLAP",
    "PDF_FONT_NOT_EMBEDDED",
    "PDF_FONT_TOUNICODE_MISSING",
    "PDF_INVALID_GLYPH_VISIBLE",
    "PDF_IMAGE_XOBJECT_INVALID",
    "PDF_SECURITY_INVALID",
    "PDF_METADATA_INVALID",
    "CONTENT_INTERNAL_IDENTIFIER_VISIBLE",
  ]);
  return {
    code,
    severity: defect.severity || (blockerCodes.has(code) ? "BLOCKER" : "ERROR"),
    page: defect.page,
    message: defect.message || defect.code || "PDF visual integrity finding",
    evidence: defect,
  };
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = JSON.stringify([finding.code, finding.page ?? null, finding.message || "", finding.evidence?.requirement || finding.requirement || null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exitCode = args.length ? 0 : 1;
    return;
  }
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.jsonPath = args[++index];
    else if (arg === "--expected-pages") options.expectedPages = Number(args[++index]);
    else if (arg === "--expected-ratio") options.expectedRatio = Number(args[++index]);
    else if (arg === "--mode") options.mode = args[++index];
    else positional.push(arg);
  }
  const pdfPath = path.resolve(positional[0]);
  const defaultOutputDir = path.join(
    process.cwd(),
    "tmp",
    "kp-visual-qa",
    slugify(path.basename(pdfPath, path.extname(pdfPath))),
  );
  const outputDir = path.resolve(positional[1] || defaultOutputDir);

  try {
    const report = await inspectPdfVisualIntegrity(pdfPath, outputDir, options);
    const summary = conciseSummary(report);
    console.log(summary);
    process.exitCode = report.hardDefects.length ? 2 : 0;
  } catch (error) {
    await writeErrorArtifacts(outputDir, pdfPath, error);
    console.error(`KP PDF Visual QA error: ${error.message}`);
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) await main();
