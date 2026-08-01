import path from "node:path";
import { atomicWriteJson, canonicalJson, sha256Digest, validateKpContract } from "./kp_reference_contracts.mjs";
import { buildProductDeliveryInventory, productMapSegmentCount } from "./kp_product_map_model.mjs";
import { validateProposalSemanticModel } from "./kp_semantic_model.mjs";
import { primaryFlowSegmentCount, roadmapWorkstreamSegmentCount } from "./kp_visualization_planner.mjs";

const DEFAULT_PROFILE_ID = "KP-LAYOUT-DEFAULTS";
const DEFAULT_PROFILE_VERSION = "1.0";

// This catalog defines supported decision surfaces and their stable order. It
// does not define a deck size: every optional surface is evaluated against the
// exact request, grounded/researched evidence and transparent model state.
const PAGE_CATALOG = Object.freeze([
  ["cover", "cover"],
  ["opening_manifesto", "opening_thesis"],
  ["problem", "problem"],
  ["market_research", "market"],
  ["market_sizing", "tam_sam_som"],
  ["analog_research", "analog_research"],
  ["launch_boundary", "ownership_boundary"],
  ["product_map", "product_mind_map"],
  ["primary_flow", "bpmn_flow"],
  ["architecture", "architecture"],
  ["org_structure", "organization_structure"],
  ["swot", "swot"],
  ["client_dependencies", "client_dependencies"],
  ["function_price", "function_price"],
  ["team", "team_size"],
  ["roadmap", "roadmap"],
  ["project_price", "project_price"],
  ["payments", "payment_stages"],
  ["close", "close"],
]);

const FACT_TRUTH = new Set(["explicit", "verified", "single_source"]);
const MODEL_TRUTH = new Set(["inferred", "assumed", "modeled"]);
const RECOMMENDATION_TRUTH = new Set(["recommended"]);
const MARKET_RESEARCH_TOPICS = new Set(["market_size", "competitors", "market_trends", "market_demand"]);

const REQUEST_PATTERNS = Object.freeze({
  problem: /(?:\bproblem\b|\bpain\b|muammo|проблем|боль)/iu,
  market_research: /(?:market\s*(?:research|analysis)|bozor\s*(?:tahlil|tadqiq)|анализ\s+рынка|исследовани[ея]\s+рынка)/iu,
  market_sizing: /(?:\bTAM\b|\bSAM\b|\bSOM\b|market\s*size|bozor\s*hajm|размер\s+рынка)/iu,
  analog_research: /(?:analog|benchmark|reference|referens|\blike\b|o['’]?xshagan|oxshagan|аналог|референс|\bкак\b)/iu,
  launch_boundary: /(?:ownership|responsibilit|scope\s*boundar|mas['’]?ul|javobgar|границ[ыа]\s+ответственност|зон[аы]\s+ответственност)/iu,
  product_map: /(?:product\s*(?:map|mind\s*map)|mind\s*map|mahsulot\s*xarita|карта\s+продукта|майндмэп|mindmap)/iu,
  primary_flow: /(?:\bBPMN\b|user\s*flow|process\s*flow|asosiy\s*jarayon|бизнес[- ]?процесс|сценарий\s+пользовател)/iu,
  architecture: /(?:infra(?:structure)?\s*diagram|architecture|arxitektura|инфраструктур|архитектур)/iu,
  org_structure: /(?:\borg(?:anization(?:al)?)?\s*(?:structure|chart)\b|\bcompany\s+(?:structure|hierarchy)\b|орг(?:анизационн[а-яё]*)?\s*структур|структур[аы]\s+(?:компани|организац))/iu,
  swot: /(?:\bSWOT\b|свот)/iu,
  client_dependencies: /(?:client(?:[- ]side)?\s*dependenc|required\s+from\s+(?:the\s+)?client|what\s+(?:we\s+)?need\s+from\s+(?:the\s+)?client|клиентск[а-яё]*\s+зависимост|зависимост[а-яё]*\s+от\s+клиент|что\s+(?:нам\s+)?(?:нужно|жд[её]м|ожидаем)\s+от\s+клиент|от\s+клиент[а-яё]*\s+(?:жд[её]м|нужно|требуется)|mijozdan\s+(?:nima\s+)?(?:kerak|kutil)|mijoz\s+tomonidan\s+(?:kerak|kutil))/iu,
  function_price: /(?:function(?:al)?\s*(?:price|cost)|feature\s*(?:price|cost)|funksiya\s*narx|стоимост[ьи]\s+функц|цена\s+функц)/iu,
  team: /(?:team\s*size|team\s*plan|jamoa|команд[аы]|\bFTE\b)/iu,
  roadmap: /(?:roadmap|timeline|delivery\s*plan|yo['’]?l\s*xarita|этап[ыа]\s+разработ|дорожн[ая]\s+карт|muddat|срок)/iu,
  // A budget constraint in the brief ("бюджет 100k") is an input, not a
  // request for a commercial price page; only price-specific wording asks
  // for the Project Price surface.
  project_price: /(?:project\s*(?:price|cost)|loyiha\s*narx|стоимост[ьи]\s+проекта|цена\s+проекта|сумма\s+проекта|\bquote\b)/iu,
  payments: /(?:payment\s*(?:schedule|stage|plan)|to['’]?lov\s*(?:jadval|bosqich)|график\s+платеж|этап[ыа]\s+оплат)/iu,
  close: /(?:close\s*page|final\s*decision|итогов\p{L}*\s+решен|решени[ея]\s+и\s+следующ|yakuniy\s+qaror)/iu,
});

const COMPATIBLE_FAMILIES = Object.freeze({
  cover: ["cover_asymmetric", "editorial_split"],
  opening_manifesto: ["value_thread", "editorial_split"],
  chapter_why_now: ["chapter_opener"],
  chapter_product: ["chapter_opener"],
  chapter_delivery: ["chapter_opener"],
  problem: ["value_thread", "connected_graph", "editorial_split"],
  market_research: ["evidence_story", "evidence_table"],
  market_sizing: ["connected_graph"],
  analog_research: ["evidence_table", "editorial_split"],
  launch_boundary: ["connected_graph"],
  product_map: ["connected_graph"],
  primary_flow: ["connected_graph"],
  architecture: ["connected_graph"],
  org_structure: ["connected_graph"],
  swot: ["quadrant"],
  client_dependencies: ["evidence_table"],
  function_price: ["evidence_table"],
  team: ["capacity_matrix", "evidence_table"],
  roadmap: ["timeline", "evidence_table"],
  project_price: ["commercial_hero"],
  payments: ["timeline", "evidence_table"],
  close: ["decision_close", "editorial_split"],
});

const FAMILY_ORDER = Object.freeze([
  "cover_asymmetric",
  "editorial_split",
  "value_thread",
  "chapter_opener",
  "connected_graph",
  "evidence_story",
  "evidence_table",
  "quadrant",
  "proportional_series",
  "capacity_matrix",
  "timeline",
  "commercial_hero",
  "decision_close",
]);

const SILHOUETTES = Object.freeze({
  cover_asymmetric: { columnCount: 2, heroSide: "left", dominantAxis: "horizontal", regionCountBucket: "low" },
  editorial_split: { columnCount: 2, heroSide: "right", dominantAxis: "horizontal", regionCountBucket: "medium" },
  value_thread: { columnCount: 1, heroSide: "none", dominantAxis: "horizontal", regionCountBucket: "low" },
  chapter_opener: { columnCount: 1, heroSide: "center", dominantAxis: "vertical", regionCountBucket: "low" },
  connected_graph: { columnCount: 3, heroSide: "center", dominantAxis: "network", regionCountBucket: "medium" },
  evidence_story: { columnCount: 2, heroSide: "left", dominantAxis: "vertical", regionCountBucket: "medium" },
  evidence_table: { columnCount: 4, heroSide: "none", dominantAxis: "vertical", regionCountBucket: "high" },
  quadrant: { columnCount: 2, heroSide: "none", dominantAxis: "grid", regionCountBucket: "medium" },
  proportional_series: { columnCount: 1, heroSide: "none", dominantAxis: "vertical", regionCountBucket: "medium" },
  capacity_matrix: { columnCount: 4, heroSide: "none", dominantAxis: "grid", regionCountBucket: "high" },
  timeline: { columnCount: 1, heroSide: "none", dominantAxis: "horizontal", regionCountBucket: "medium" },
  commercial_hero: { columnCount: 1, heroSide: "center", dominantAxis: "vertical", regionCountBucket: "low" },
  decision_close: { columnCount: 2, heroSide: "right", dominantAxis: "vertical", regionCountBucket: "medium" },
});

const VISUALIZATION_KINDS = new Set(["market_sizing", "launch_boundary", "product_map", "primary_flow", "architecture", "roadmap"]);
const SEGMENTABLE_PAGE_KINDS = new Set(["product_map", "primary_flow", "function_price", "roadmap"]);
const FUNCTION_SCHEDULE_ROWS_PER_PAGE = 14;

export function buildPresentationPlan({ requestId, proposalModel = {}, visualStyleProfile, styleProfile, semanticModel = {} } = {}) {
  const profile = visualStyleProfile || styleProfile || {};
  const planningContext = buildPlanningContext(proposalModel, semanticModel);
  const pageDecisions = PAGE_CATALOG.map(([kind, intent]) => evaluatePageCandidate(kind, intent, planningContext));
  const selectedDecisions = expandSelectedPageDecisions(pageDecisions.filter((decision) => decision.include), planningContext);
  const diagnostics = {
    layoutSelections: [],
    defaultIntroductions: [],
    distinctLayoutFamilyCount: 0,
    pageDecisions,
    researchRequests: pageDecisions
      .filter((decision) => decision.researchRequired)
      .map((decision) => ({ kind: decision.kind, reason: decision.reasons.join("; "), fallbackMode: decision.fallbackMode })),
    suppressedDuplicates: pageDecisions
      .filter((decision) => decision.reasons.includes("suppressed_semantic_duplicate_of_close"))
      .map((decision) => `${decision.kind}:close`),
  };
  const history = [];
  const pages = selectedDecisions.map((decision, index) => {
    const { kind, intent } = decision;
    const pageNumber = index + 1;
    const selection = selectPageLayoutFamily(kind, profile, history, { pageNumber, diagnostics });
    const page = {
      pageNumber,
      kind,
      intent,
      layoutFamily: selection.family,
      selectionScore: selection.score,
      visualizationSpecId: VISUALIZATION_KINDS.has(kind) ? `VSPEC-P${String(pageNumber).padStart(2, "0")}` : null,
      notes: selection.notes,
      contentClasses: decision.contentClasses,
      sourceIds: decision.sourceIds,
      derivationRuleIds: decision.derivationRuleIds,
      selectionReasons: decision.reasons,
      decisionRelevance: decision.relevance,
      researchRequired: decision.researchRequired,
      fallbackMode: decision.fallbackMode,
      ...(decision.segmentIndex ? { segmentIndex: decision.segmentIndex, segmentCount: decision.segmentCount } : {}),
    };
    history.push(page);
    diagnostics.layoutSelections.push({
      pageNumber,
      kind,
      selectedFamily: selection.family,
      score: selection.score,
      candidates: selection.candidates,
    });
    return page;
  });
  diagnostics.distinctLayoutFamilyCount = new Set(pages.map((page) => page.layoutFamily)).size;
  const plan = {
    schemaVersion: "1.0",
    planId: `PPLAN-${requestId || semanticModel.requestId || proposalModel.requestId || "LOCAL"}`,
    requestId: requestId || semanticModel.requestId || proposalModel.requestId || "KP-20260713-LOCAL01",
    pageCount: pages.length,
    canvas: { width: 1440, height: 960, aspectRatio: 1.5 },
    pages,
    diagnostics,
    warnings: [
      "dynamic_page_selection",
      ...diagnostics.researchRequests.map((row) => `research_required:${row.kind}`),
    ],
  };
  return Object.freeze({ ...plan, planHash: computePlanHash(plan) });
}

export function selectPageLayoutFamily(pageKind, styleProfile = {}, history = [], { pageNumber = history.length + 1, diagnostics = null } = {}) {
  const allowed = COMPATIBLE_FAMILIES[pageKind];
  if (!allowed) throw Object.assign(new Error(`Unknown page kind: ${pageKind}`), { code: "PRESENTATION_PAGE_KIND_UNKNOWN" });
  const preferences = normalizeFamilyPreferences(styleProfile, allowed, pageNumber, diagnostics);
  const previous = history.at(-1);
  const beforePrevious = history.at(-2);
  const candidates = allowed.map((family) => {
    const styleConfidence = preferences.get(family) ?? 0.35;
    const unusedSilhouetteBonus = history.some((page) => page.layoutFamily === family) ? (history.slice(-5).some((page) => page.layoutFamily === family) ? 0 : 4) : 10;
    const consecutiveRepeatPenalty = previous?.layoutFamily === family && beforePrevious?.layoutFamily === family ? 100 : previous?.layoutFamily === family ? 40 : 0;
    const recentGeometrySimilarityPenalty = geometryPenalty(family, previous?.layoutFamily);
    const score = (40 * styleConfidence) + unusedSilhouetteBonus - consecutiveRepeatPenalty - recentGeometrySimilarityPenalty;
    return { family, score, styleConfidence, unusedSilhouetteBonus, consecutiveRepeatPenalty, recentGeometrySimilarityPenalty };
  }).sort((a, b) => b.score - a.score || b.styleConfidence - a.styleConfidence || FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
  const selected = candidates[0];
  return { family: selected.family, score: selected.score, candidates, notes: [] };
}

export async function validatePresentationPlan(plan, options = {}) {
  const schema = await validateKpContract("presentationPlan", plan, options);
  if (!schema.ok) return schema;
  const findings = validatePresentationPlanSemantics(plan);
  if (findings.length) {
    if (options.throwOnError === false) return { ok: false, errors: findings };
    throw Object.assign(new Error(`Presentation plan failed semantic validation: ${findings.map((item) => `${item.path} ${item.message}`).join("; ")}`), {
      code: "PRESENTATION_PLAN_INVALID",
      errors: findings,
    });
  }
  const expected = computePlanHash(plan);
  if (plan.planHash !== expected) {
    const error = { path: "/planHash", keyword: "integrity", message: "must equal canonical SHA-256 of plan excluding /planHash", params: { expected } };
    if (options.throwOnError === false) return { ok: false, errors: [error] };
    throw Object.assign(new Error("Presentation plan hash mismatch"), { code: "PRESENTATION_PLAN_HASH_MISMATCH", errors: [error] });
  }
  return schema;
}

export function validatePresentationPlanSemantics(plan = {}) {
  const findings = [];
  const pages = plan.pages || [];
  if (pages.length < 2 || pages.length > 50) findings.push(error("/pages", "must contain between 2 and 50 pages"));
  if (Number(plan.pageCount) !== pages.length) findings.push(error("/pageCount", "must match the pages array length"));
  if (pages.some((page, index) => Number(page.pageNumber) !== index + 1)) findings.push(error("/pages", "page numbers must be sequential from 1"));
  if (pages[0]?.kind !== "cover") findings.push(error("/pages/0/kind", "the first page must be cover"));
  const closeIndex = pages.findIndex((page) => page.kind === "close");
  if (closeIndex >= 0 && closeIndex !== pages.length - 1) {
    findings.push(error(`/pages/${closeIndex}/kind`, "a close page must be the last page"));
  }
  const distinct = new Set((plan.pages || []).map((page) => page.layoutFamily));
  const minimumDistinctFamilies = Math.min(pages.length, Math.max(2, Math.min(4, Math.ceil(pages.length / 4))));
  if (distinct.size < minimumDistinctFamilies) findings.push(error("/diagnostics/distinctLayoutFamilyCount", `must use at least ${minimumDistinctFamilies} distinct layout families for this plan`));
  for (let index = 0; index < (plan.pages || []).length; index += 1) {
    const page = plan.pages[index];
    const allowed = COMPATIBLE_FAMILIES[page.kind] || [];
    if (!allowed.includes(page.layoutFamily)) findings.push(error(`/pages/${index}/layoutFamily`, `layout family ${page.layoutFamily} is incompatible with ${page.kind}`));
    if (VISUALIZATION_KINDS.has(page.kind) && page.layoutFamily !== "connected_graph" && !["market_sizing", "roadmap"].includes(page.kind)) {
      findings.push(error(`/pages/${index}/layoutFamily`, "semantic graph page must use connected_graph"));
    }
    const expectedSpecId = VISUALIZATION_KINDS.has(page.kind) ? `VSPEC-P${String(page.pageNumber).padStart(2, "0")}` : null;
    if ((page.visualizationSpecId || null) !== expectedSpecId) findings.push(error(`/pages/${index}/visualizationSpecId`, "must match the page kind and number"));
    if (Array.isArray(page.contentClasses)) {
      if (!page.contentClasses.length || page.contentClasses.some((value) => !["fact", "model", "recommendation"].includes(value))) {
        findings.push(error(`/pages/${index}/contentClasses`, "must contain fact, model and/or recommendation"));
      }
      if (page.contentClasses.includes("fact") && !Array.isArray(page.sourceIds)) findings.push(error(`/pages/${index}/sourceIds`, "fact pages must declare sourceIds"));
      if ((page.contentClasses.includes("model") || page.contentClasses.includes("recommendation")) && !Array.isArray(page.derivationRuleIds)) {
        findings.push(error(`/pages/${index}/derivationRuleIds`, "model/recommendation pages must declare derivationRuleIds"));
      }
    }
  }
  for (const [index, page] of pages.entries()) {
    if (["chapter_why_now", "chapter_product", "chapter_delivery"].includes(page.kind) && page.layoutFamily !== "chapter_opener") {
      findings.push(error(`/pages/${index}/layoutFamily`, "chapter pages must use chapter_opener"));
    }
  }
  for (const kind of SEGMENTABLE_PAGE_KINDS) {
    const kindPages = pages.filter((page) => page.kind === kind);
    const segmentedPages = kindPages.filter((page) => page.segmentIndex || page.segmentCount);
    if (!segmentedPages.length) continue;
    const expectedCount = kindPages.length;
    const indices = segmentedPages.map((page) => Number(page.segmentIndex));
    if (segmentedPages.length !== kindPages.length
      || segmentedPages.some((page) => Number(page.segmentCount) !== expectedCount)
      || indices.some((value, index) => value !== index + 1)) {
      findings.push(error("/pages", `segmented ${kind} pages must declare sequential segmentIndex values and a shared segmentCount`));
    }
  }
  for (const [index, page] of pages.entries()) {
    if (!SEGMENTABLE_PAGE_KINDS.has(page.kind) && (page.segmentIndex || page.segmentCount)) {
      findings.push(error(`/pages/${index}`, "segment metadata is only valid for product-map, BPMN, function-schedule, or roadmap continuation pages"));
    }
  }
  if (plan.diagnostics?.distinctLayoutFamilyCount !== distinct.size) findings.push(error("/diagnostics/distinctLayoutFamilyCount", "must match actual layout family count"));
  return findings;
}

export function selectDynamicPageDecisions(proposalModel = {}, semanticModel = {}) {
  const context = buildPlanningContext(proposalModel, semanticModel);
  return PAGE_CATALOG.map(([kind, intent]) => evaluatePageCandidate(kind, intent, context));
}

function expandSelectedPageDecisions(decisions, context) {
  return decisions.flatMap((decision) => {
    let segmentCount = 1;
    let continuationReason = "";
    if (decision.kind === "product_map") {
      segmentCount = productMapSegmentCount(context.semanticModel);
      continuationReason = "mind_map_continuation_for_readability";
    } else if (decision.kind === "primary_flow") {
      segmentCount = primaryFlowSegmentCount(context.semanticModel);
      continuationReason = "bpmn_continuation_for_complete_process_coverage";
    } else if (decision.kind === "function_price") {
      segmentCount = Math.max(1, Math.ceil(buildProductDeliveryInventory(context.semanticModel).length / FUNCTION_SCHEDULE_ROWS_PER_PAGE));
      continuationReason = "function_schedule_continuation_for_readability";
    } else if (decision.kind === "roadmap") {
      segmentCount = roadmapWorkstreamSegmentCount(context.semanticModel);
      continuationReason = "roadmap_continuation_for_complete_scope_coverage";
    } else {
      return [decision];
    }
    return Array.from({ length: segmentCount }, (_, index) => ({
      ...decision,
      segmentIndex: index + 1,
      segmentCount,
      reasons: segmentCount > 1
        ? unique([...decision.reasons, continuationReason])
        : decision.reasons,
    }));
  });
}

export function requestedPageKindsFromPrompt(prompt = "") {
  const text = String(prompt || "");
  return Object.freeze(Object.entries(REQUEST_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([kind]) => kind));
}

function buildPlanningContext(proposalModel = {}, semanticModel = {}) {
  const brief = proposalModel.groundedBrief || proposalModel.grounded_brief || {};
  const prompt = [
    proposalModel.brief?.prompt,
    proposalModel.prompt,
    proposalModel.requestText,
  ].filter(Boolean).join(" ");
  const requestedKinds = new Set([
    ...requestedPageKindsFromPrompt(prompt),
    ...array(brief.requestedSections).map(String),
  ]);
  const sources = array(proposalModel.sources).length ? array(proposalModel.sources) : array(semanticModel.sources);
  const researchStatus = proposalModel.researchStatus || proposalModel.marketResearch?.researchStatus || {};
  const budgetRecord = briefRecord(brief.budget?.amount);
  const timelineRecord = briefRecord(brief.timeline?.months);
  const projectRecord = {
    truthStatus: array(semanticModel.project?.sourceIds).length ? "explicit" : "recommended",
    sourceIds: array(semanticModel.project?.sourceIds),
    derivationRuleId: array(semanticModel.project?.sourceIds).length ? null : "PROJECT-SUMMARY-V1",
  };
  return {
    proposalModel,
    semanticModel,
    brief,
    prompt,
    requestedKinds,
    sources,
    researchStatus,
    budgetRecord,
    timelineRecord,
    projectRecord,
  };
}

function evaluatePageCandidate(kind, intent, context) {
  const records = recordsForPage(kind, context).filter(Boolean);
  const contentClasses = classifyContent(records);
  const sourceIds = unique(records.flatMap((row) => sourceIdsForRecord(row)));
  const derivationRuleIds = unique(records.map((row) => row?.derivationRuleId).filter(Boolean).map(String));
  const explicitlyRequested = context.requestedKinds.has(kind);
  const factCount = records.filter((row) => FACT_TRUTH.has(truthOf(row))).length;
  const modelCount = records.filter((row) => MODEL_TRUTH.has(truthOf(row))).length;
  const recommendationCount = records.filter((row) => RECOMMENDATION_TRUTH.has(truthOf(row))).length;
  const policy = inclusionPolicy(kind, context, { records, factCount, modelCount, recommendationCount, explicitlyRequested });
  const effectiveClasses = contentClasses.length
    ? contentClasses
    : [explicitlyRequested && policy.fallbackMode === "transparent_model" ? "model" : "recommendation"];
  const researchRequired = Boolean(policy.include && policy.researchRequired);
  return Object.freeze({
    kind,
    intent,
    include: Boolean(policy.include),
    explicitlyRequested,
    relevance: Number(policy.relevance.toFixed(3)),
    contentClasses: effectiveClasses,
    sourceIds,
    derivationRuleIds: effectiveClasses.some((value) => value !== "fact") && !derivationRuleIds.length
      ? [policy.derivationRuleId || "DYNAMIC-PAGE-SELECTION-V1"]
      : derivationRuleIds,
    researchRequired,
    fallbackMode: policy.fallbackMode || "none",
    reasons: policy.reasons,
  });
}

function inclusionPolicy(kind, context, stats) {
  const { records, factCount, modelCount, recommendationCount, explicitlyRequested } = stats;
  const hasFacts = factCount > 0;
  const hasModel = modelCount > 0;
  const hasRecommendation = recommendationCount > 0;
  const requested = explicitlyRequested;
  const reasons = [];
  let include = false;
  let researchRequired = false;
  let fallbackMode = "none";
  let relevance = 0;

  if (kind === "cover") {
    return { include: true, relevance: 1, researchRequired: false, fallbackMode: "none", reasons: ["mandatory_decision_surface"] };
  }
  if (kind === "close") {
    // The close page only earns its place when there is a commercial decision
    // to close (a price/payment surface) or the client explicitly asked for
    // it; otherwise it merely repeats the dependency and price pages.
    const commercialSurface = closeDecisionSurfaces(context);
    const include = requested || commercialSurface;
    return {
      include,
      relevance: include ? (requested ? 0.98 : 0.9) : 0,
      researchRequired: false,
      fallbackMode: "none",
      reasons: include
        ? [requested ? "explicitly_requested_in_prompt" : "commercial_decision_surface_present"]
        : ["no_commercial_decision_to_close"],
    };
  }

  if (requested) {
    include = true;
    relevance = 0.98;
    reasons.push("explicitly_requested_in_prompt");
    if (!hasFacts) {
      researchRequired = researchableKinds().has(kind);
      fallbackMode = "transparent_model";
      reasons.push(researchRequired ? "grounded_evidence_missing_research_required" : "transparent_model_required");
    }
  }

  switch (kind) {
    case "opening_manifesto":
      // The mandatory close already carries the decision summary. A generic
      // opening thesis must not create a second summary page merely because
      // recordsForPage() can synthesize copy for it.
      include = requested;
      if (!requested) reasons.push("suppressed_semantic_duplicate_of_close");
      break;
    case "problem":
      include ||= hasFacts;
      if (hasFacts && !requested) reasons.push("grounded_problem_evidence_available");
      break;
    case "market_research": {
      const marketEvidence = marketResearchEvidence(context);
      include ||= marketEvidence.ready;
      if (marketEvidence.ready && !requested) reasons.push("decision_relevant_market_research_available");
      break;
    }
    case "market_sizing": {
      const market = context.semanticModel.market || {};
      const numericMarket = Boolean(market.tam?.value && market.sam?.value && array(market.somScenarios).length);
      const decisionRelevantPendingModel = marketSizingAffectsDecision(context);
      const completeMarket = numericMarket && ["verified", "modeled"].includes(String(market.status || ""));
      include ||= completeMarket || decisionRelevantPendingModel;
      if (completeMarket && !requested) reasons.push("market_model_complete");
      if (!completeMarket && decisionRelevantPendingModel && !requested) {
        reasons.push("decision_relevant_market_formula_pending");
        researchRequired = true;
        fallbackMode = "transparent_model";
      }
      break;
    }
    case "analog_research": {
      // The analog page needs a real named analog: an empty brief fact object
      // or a client's own site must not masquerade as benchmark research.
      const namedAnalog = Boolean(context.brief.analog?.name?.value || context.brief.analog?.url?.value);
      const researchedAnalogs = array(context.semanticModel.analogs).length > 0;
      include ||= namedAnalog || researchedAnalogs;
      if (include && !requested) reasons.push("explicit_or_researched_analog_available");
      break;
    }
    case "launch_boundary": {
      const factBackedScope = array(context.semanticModel.scopeItems).filter((row) => FACT_TRUTH.has(truthOf(row)));
      const ownershipKinds = new Set(factBackedScope.map((row) => row.ownership).filter((value) => value && value !== "unknown"));
      const boundaryReady = factBackedScope.length >= 2 && ownershipKinds.size >= 2;
      include ||= boundaryReady;
      if (boundaryReady && !requested) reasons.push("multiple_grounded_ownership_boundaries_available");
      break;
    }
    case "product_map": {
      const relevantScope = array(context.semanticModel.scopeItems).filter((row) => !["deferred", "out_of_scope"].includes(row.inclusion));
      include ||= relevantScope.length >= 2;
      if (include && !requested) reasons.push(hasFacts ? "grounded_product_scope_available" : "recommended_product_model_is_decision_relevant");
      break;
    }
    case "primary_flow": {
      const process = array(context.semanticModel.processes).find((row) => row.id === context.semanticModel.primaryProcessId || row.type === "primary");
      const flowReady = Boolean(process && array(process.nodeRefs).length >= 4 && array(process.relationIds).length >= 3);
      include ||= flowReady;
      if (flowReady && !requested) reasons.push(hasFacts ? "grounded_primary_flow_available" : "recommended_primary_flow_is_decision_relevant");
      break;
    }
    case "architecture": {
      const groundedComponents = array(context.semanticModel.architecture?.components).filter((row) => FACT_TRUTH.has(truthOf(row)) || sourceIdsForRecord(row).length);
      const groundedArchitecture = groundedComponents.length >= 3 && array(context.semanticModel.architecture?.relations).length >= 2;
      const recommendedArchitecture = array(context.semanticModel.architecture?.components).length >= 3
        && array(context.semanticModel.architecture?.relations).length >= 2
        && array(context.semanticModel.scopeItems).length >= 2;
      include ||= groundedArchitecture || recommendedArchitecture;
      if (groundedArchitecture && !requested) reasons.push("grounded_architecture_available");
      if (!groundedArchitecture && recommendedArchitecture && !requested) reasons.push("transparent_recommended_architecture_available");
      break;
    }
    case "org_structure": {
      // Semantic actors are a safe fallback for an explicitly requested role
      // model, but they must not auto-create a company org page. Automatic
      // inclusion requires a separately researched organization model.
      const groundedOrganization = organizationRecords(context.proposalModel, { actors: [] })
        .filter((row) => FACT_TRUTH.has(truthOf(row)) && sourceIdsForRecord(row).length);
      const proposedOrganization = context.proposalModel.organizationStructure || {};
      const proposedBranches = array(proposedOrganization.branches);
      const completeProposedModel = proposedOrganization.mode === "proposed_role_model"
        && proposedBranches.length >= 3
        && proposedBranches.every((row) => array(row.children).length > 0);
      include ||= groundedOrganization.length >= 4 || completeProposedModel;
      if (groundedOrganization.length >= 4 && !requested) reasons.push("grounded_organization_structure_available");
      if (completeProposedModel && groundedOrganization.length < 4 && !requested) reasons.push("transparent_project_operating_model_available");
      break;
    }
    case "swot": {
      const groundedSwot = array(context.semanticModel.swot).filter((row) => FACT_TRUTH.has(truthOf(row))).length >= 4;
      include ||= groundedSwot;
      if (groundedSwot && !requested) reasons.push("grounded_swot_available");
      break;
    }
    case "client_dependencies": {
      const dependencies = array(context.proposalModel.clientDependencies).length
        ? array(context.proposalModel.clientDependencies)
        : array(context.semanticModel.clientDependencies);
      const readinessSurface = dependencies.length >= 3;
      include ||= readinessSurface;
      if (readinessSurface && !requested) reasons.push("structured_client_readiness_dependencies_available");
      break;
    }
    case "function_price": {
      const inventory = array(context.proposalModel.functionPrice);
      const scopedFunctions = array(context.semanticModel.scopeItems)
        .filter((row) => !["deferred", "out_of_scope"].includes(String(row?.inclusion || "").toLowerCase()));
      const rows = inventory.filter((row) => Number(row.total ?? row.amount ?? row.price) > 0);
      const groundedRows = rows.filter((row) => FACT_TRUTH.has(truthOf(row)));
      const modeledRows = rows.filter((row) => MODEL_TRUTH.has(truthOf(row)) || RECOMMENDATION_TRUTH.has(truthOf(row)));
      const modeledSubtotal = rows.reduce((sum, row) => sum + Number(row.total ?? row.amount ?? row.price ?? 0), 0);
      const statedBudget = Number(context.brief.budget?.amount?.value || context.proposalModel.pricing?.projectPrice || 0);
      const reconciledModel = modeledRows.length >= 2 && statedBudget > 0 && Math.abs(modeledSubtotal - statedBudget) < 0.01;
      const transparentCostGap = inventory.length >= 2 && statedBudget > 0 && rows.length === 0;
      // The functional delivery schedule is a baseline proposal surface even
      // when the client has not supplied a budget yet. In that state the page
      // keeps the agreed/recommended blocks and timelines visible without
      // inventing allocation amounts.
      const functionalBaseline = inventory.length > 0 || scopedFunctions.length > 0;
      include ||= groundedRows.length >= 2 || reconciledModel || transparentCostGap || functionalBaseline;
      if (groundedRows.length >= 2 && !requested) reasons.push("grounded_function_allocation_available");
      if (!groundedRows.length && reconciledModel && !requested) reasons.push("reconciled_function_planning_scenario_available");
      if (transparentCostGap && !requested) {
        reasons.push("functional_cost_inputs_pending");
        researchRequired = true;
        fallbackMode = "transparent_model";
      }
      if (functionalBaseline && !groundedRows.length && !reconciledModel && !transparentCostGap && !requested) {
        reasons.push("functional_schedule_available_cost_inputs_pending");
        fallbackMode = "transparent_model";
      }
      break;
    }
    case "team": {
      const team = context.proposalModel.teamPlan || {};
      const researchedTeam = array(team.sourceIds).length > 0 || array(team.roleAllocations).some((row) => sourceIdsForRecord(row).length > 0);
      const durationMonths = Number(context.semanticModel.project?.durationMonths || context.proposalModel.durationMonths || 0);
      const renderableDuration = Number.isInteger(durationMonths) && durationMonths >= 2 && durationMonths <= 6;
      const completeModeledTeam = array(team.roleAllocations).length >= 2
        && Number(team.people) > 0
        && Number(team.fteMonths) > 0
        && Number(team.peakFte) > 0
        && renderableDuration;
      include ||= (renderableDuration && researchedTeam && (Number(team.people) > 0 || array(team.roleAllocations).length > 0)) || completeModeledTeam;
      if (researchedTeam && include && !requested) reasons.push("researched_team_model_available");
      if (!researchedTeam && completeModeledTeam && !requested) reasons.push("transparent_capacity_model_available");
      break;
    }
    case "roadmap": {
      const explicitTimeline = FACT_TRUTH.has(truthOf(context.timelineRecord));
      const groundedPhases = array(context.semanticModel.roadmap?.phases).some((row) => FACT_TRUTH.has(truthOf(row)));
      include ||= explicitTimeline || groundedPhases;
      if (include && !requested) reasons.push(explicitTimeline ? "explicit_delivery_window_requires_plan" : "grounded_roadmap_available");
      break;
    }
    case "project_price": {
      // A brief budget alone must not create a commercial price page: without
      // a grounded project price the surface only restates the client's own
      // input as if it were an offer.
      const groundedPrice = Number(context.semanticModel.commercial?.projectPrice) > 0 && hasFacts;
      include ||= groundedPrice;
      if (groundedPrice && !requested) reasons.push("grounded_project_total_available");
      break;
    }
    case "payments": {
      const groundedPayments = array(context.proposalModel.payments).filter((row) => FACT_TRUTH.has(truthOf(row)) && Number(row.amount) > 0);
      const scenarioRows = array(context.proposalModel.payments).filter((row) => Number(row.amount) > 0);
      const commercialBaseline = array(context.proposalModel.functionPrice).length > 0
        || array(context.semanticModel.scopeItems).some((row) => !["deferred", "out_of_scope"].includes(String(row?.inclusion || "").toLowerCase()));
      const statedBudget = Number(context.brief.budget?.amount?.value || 0);
      const explicitBudgetCurrency = String(context.brief.budget?.currency?.status || "").toLowerCase() === "explicit";
      const scenarioTotal = scenarioRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      // A budget stated with an explicit currency carries a reconciled payment
      // scenario: the schedule restates the client's own figure as staged
      // planning amounts, disclosed as a scenario rather than a quote.
      const budgetScenario = scenarioRows.length >= 2
        && statedBudget > 0
        && explicitBudgetCurrency
        && Math.abs(scenarioTotal - statedBudget) < 0.01;
      // Keep the payment decision surface in every scoped commercial
      // proposal. With no accepted schedule the renderer shows an explicit
      // input-required state, not a fabricated payment plan.
      include = requested || groundedPayments.length > 0 || budgetScenario || commercialBaseline;
      if (groundedPayments.length && !requested) reasons.push("grounded_payment_schedule_available");
      if (!groundedPayments.length && budgetScenario) {
        reasons.push("budget_based_payment_scenario_available");
        fallbackMode = "transparent_model";
      }
      if (commercialBaseline && !groundedPayments.length && !budgetScenario && !requested) {
        reasons.push("payment_schedule_inputs_pending");
        fallbackMode = "transparent_model";
      }
      if (!include) reasons.push("scenario_only_payment_schedule_suppressed");
      break;
    }
    default:
      break;
  }

  if (include && relevance === 0) {
    relevance = hasFacts ? 0.88 : hasModel ? 0.74 : hasRecommendation ? 0.66 : 0.6;
  }
  if (!include) relevance = 0;
  if (include && !reasons.length) reasons.push("decision_relevant_content_available");
  if (!include && !reasons.length) reasons.push("no_decision_relevant_grounding");
  if (include && !hasFacts && fallbackMode === "none" && (hasModel || hasRecommendation)) fallbackMode = "transparent_model";
  return {
    include,
    relevance,
    researchRequired,
    fallbackMode,
    derivationRuleId: hasRecommendation ? "RECOMMENDATION-SYNTHESIS-V1" : "TRANSPARENT-MODEL-V1",
    reasons,
  };
}

function closeDecisionSurfaces(context) {
  // Only a grounded project price creates a decision surface that needs the
  // closing page. A budget-based payment scenario restates the client's own
  // budget, so it must not resurrect the close page on its own.
  return ["project_price"].some((kind) => {
    const intent = PAGE_CATALOG.find(([candidate]) => candidate === kind)?.[1] || kind;
    return evaluatePageCandidate(kind, intent, context).include;
  });
}

function marketSizingAffectsDecision(context = {}) {
  const proposal = context.proposalModel || {};
  const explicitSignal = proposal.marketSizingDecisionImpact
    ?? proposal.marketDecision?.marketSizingRequired
    ?? proposal.market?.decisionImpact
    ?? proposal.tamSamSom?.decisionImpact;
  if (explicitSignal === true || /^(?:required|decision_relevant|material)$/iu.test(String(explicitSignal || "").trim())) return true;

  const decisionText = [
    context.prompt,
    proposal.brief?.purpose,
    proposal.brief?.goal,
    proposal.marketDecision?.reason,
    proposal.investmentContext,
  ].filter(Boolean).join(" ");
  return /(?:fund\s*rais|invest(?:ment|or|able)|market[-\s]?entry|go[-\s]?to[-\s]?market|enter(?:ing)?\s+(?:a\s+)?new\s+market|launch\s+geograph|target\s+geograph|geograph(?:y|ic)\s+decision|инвест|привлечени\p{L}*\s+финансирован|выход\p{L}*\s+на\s+(?:нов\p{L}*\s+)?рынок|географ\p{L}*\s+запуск|investits|sarmoya|bozorga\s+chiq|yangi\s+bozor|ishga\s+tushirish\s+geograf)/iu.test(decisionText);
}

function recordsForPage(kind, context) {
  const proposal = context.proposalModel;
  const semantic = context.semanticModel;
  switch (kind) {
    case "cover":
      return [context.projectRecord, context.budgetRecord, context.timelineRecord];
    case "opening_manifesto":
      return [{ truthStatus: "recommended", sourceIds: [], derivationRuleId: "EXECUTIVE-DECISION-THESIS-V1" }];
    case "problem": {
      const problemClaims = array(proposal.claimLedger).filter((row) => /problem|pain|risk|issue|manual|muammo|xavf|проблем|риск|ручн/i.test(String(row?.text || row?.label || "")));
      if (proposal.problemStatement || proposal.narrative?.problemStatement) {
        problemClaims.push({ truthStatus: "recommended", sourceIds: [], derivationRuleId: "PROBLEM-NARRATIVE-V1" });
      }
      return problemClaims;
    }
    case "market_research":
      return marketResearchEvidence(context).sources
        .map((row) => ({ truthStatus: "single_source", sourceIds: [row.id].filter(Boolean), derivationRuleId: null }));
    case "market_sizing":
      return [semantic.market?.tam, semantic.market?.sam, ...array(semantic.market?.somScenarios)];
    case "analog_research":
      return [...array(semantic.analogs), briefRecord(context.brief.analog?.name), briefRecord(context.brief.analog?.url)];
    case "launch_boundary":
    case "product_map":
      return array(semantic.scopeItems);
    case "primary_flow":
      return [...array(semantic.tasks), ...array(semantic.events), ...array(semantic.decisions), ...array(semantic.processes)];
    case "architecture":
      return [...array(semantic.architecture?.components), ...array(semantic.architecture?.boundaries)];
    case "org_structure":
      return organizationRecords(proposal, semantic);
    case "swot":
      return array(semantic.swot);
    case "client_dependencies":
      return array(proposal.clientDependencies).length
        ? array(proposal.clientDependencies)
        : array(proposal.groundedBrief?.clientDependencies).length
          ? array(proposal.groundedBrief.clientDependencies)
          : array(semantic.clientDependencies);
    case "function_price":
      return array(proposal.functionPrice).length ? array(proposal.functionPrice) : array(semantic.commercial?.functionPrice);
    case "team": {
      const team = proposal.teamPlan || {};
      const status = truthOf(team) === "unknown" && array(team.sourceIds).length ? "single_source" : truthOf(team);
      return array(team.roleAllocations).map((row) => ({ ...row, truthStatus: truthOf(row) === "unknown" ? status : truthOf(row), sourceIds: sourceIdsForRecord(row).length ? sourceIdsForRecord(row) : array(team.sourceIds), derivationRuleId: row.derivationRuleId || team.derivationRuleId || null }));
    }
    case "roadmap":
      return [context.timelineRecord, ...array(semantic.roadmap?.phases)];
    case "project_price": {
      const team = proposal.teamPlan || {};
      const teamStatus = truthOf(team) === "unknown" && array(team.sourceIds).length ? "single_source" : truthOf(team);
      const teamRows = array(team.roleAllocations).map((row) => ({
        ...row,
        truthStatus: truthOf(row) === "unknown" ? teamStatus : truthOf(row),
        sourceIds: sourceIdsForRecord(row).length ? sourceIdsForRecord(row) : array(team.sourceIds),
        derivationRuleId: row.derivationRuleId || team.derivationRuleId || null,
      }));
      return [context.budgetRecord, ...array(proposal.functionPrice).filter((row) => FACT_TRUTH.has(truthOf(row))), ...teamRows];
    }
    case "payments":
      return array(proposal.payments);
    case "close":
      return [{ truthStatus: "recommended", sourceIds: [], derivationRuleId: "DECISION-CLOSE-V1" }];
    default:
      return [];
  }
}

function classifyContent(records = []) {
  const classes = new Set();
  for (const row of records) {
    const truth = truthOf(row);
    if (FACT_TRUTH.has(truth)) classes.add("fact");
    else if (MODEL_TRUTH.has(truth)) classes.add("model");
    else if (RECOMMENDATION_TRUTH.has(truth)) classes.add("recommendation");
  }
  return ["fact", "model", "recommendation"].filter((value) => classes.has(value));
}

function briefRecord(value) {
  if (!value || typeof value !== "object") return null;
  return {
    truthStatus: String(value.truthStatus || value.status || "unknown").toLowerCase(),
    sourceIds: unique(array(value.sourceIds).concat(array(value.evidenceRefs).map((row) => row?.sourceId).filter(Boolean))),
    derivationRuleId: value.derivationRuleId || null,
  };
}

function marketResearchEvidence(context = {}) {
  const geography = context.brief?.geography;
  const geographyRecord = briefRecord(geography);
  const briefGeographyConfirmed = Boolean(
    geography?.value
    && geographyRecord
    && FACT_TRUTH.has(truthOf(geographyRecord)),
  );
  const semanticMarket = context.semanticModel?.market || {};
  const semanticGeographyConfirmed = Boolean(
    semanticMarket.geography
    && String(semanticMarket.status || "").toLowerCase() === "verified"
    && array(semanticMarket.sourceIds).length,
  );
  const seen = new Set();
  const sources = [];
  for (const source of array(context.sources)) {
    const topic = String(source?.researchTopic || source?.topic || "").toLowerCase();
    const status = String(source?.status || "").toLowerCase();
    if (!MARKET_RESEARCH_TOPICS.has(topic) || !/read|verified|profiled|extracted/.test(status) || /failed|blocked|captcha|empty/.test(status)) continue;
    const key = canonicalSourceKey(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  const topicCount = new Set(sources.map((source) => String(source.researchTopic || source.topic || "").toLowerCase())).size;
  const hardResearchFailure = /offline|failed|blocked|unavailable/i.test(String(context.researchStatus?.status || ""));
  return {
    sources,
    ready: (briefGeographyConfirmed || semanticGeographyConfirmed)
      && sources.length >= 2
      && topicCount >= 2
      && !hardResearchFailure,
  };
}

function canonicalSourceKey(source = {}) {
  const raw = String(source.source || source.url || source.id || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:gclid|fbclid|ref)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function truthOf(row) {
  return String(row?.truthStatus || row?.status || "unknown").toLowerCase();
}

function sourceIdsForRecord(row) {
  return unique(array(row?.sourceIds).concat(array(row?.evidenceRefs).map((item) => item?.sourceId).filter(Boolean)).map(String));
}

function organizationRecords(proposal = {}, semantic = {}) {
  const records = [];
  const seen = new Set();
  const childKeys = ["root", "branches", "groups", "departments", "teams", "roles", "positions", "nodes", "members", "children", "reports"];

  const collect = (value, inherited = {}) => {
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, inherited));
      return;
    }
    if (!value || typeof value !== "object") return;

    const recordTruth = truthOf(value);
    const recordSourceIds = sourceIdsForRecord(value);
    const normalized = {
      ...value,
      truthStatus: recordTruth !== "unknown" ? recordTruth : inherited.truthStatus || "unknown",
      sourceIds: recordSourceIds.length ? recordSourceIds : array(inherited.sourceIds),
      derivationRuleId: value.derivationRuleId || inherited.derivationRuleId || null,
    };
    const identity = value.id ? `id:${value.id}` : value;
    if (!seen.has(identity)) {
      seen.add(identity);
      records.push(normalized);
    }

    const nextInherited = {
      truthStatus: normalized.truthStatus,
      sourceIds: normalized.sourceIds,
      derivationRuleId: normalized.derivationRuleId,
    };
    childKeys.forEach((key) => collect(value[key], nextInherited));
  };

  collect(proposal.organizationStructure);
  collect(semantic.actors);
  return records;
}

function researchableKinds() {
  return new Set(["market_research", "market_sizing", "analog_research", "architecture", "org_structure", "team", "function_price", "project_price"]);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export async function persistPlanningArtifacts(requestWorkspace, { semanticModel, presentationPlan, visualizationSpecs = [] } = {}) {
  const written = {};
  if (semanticModel) {
    await validateProposalSemanticModel(semanticModel);
    written.semanticModel = await atomicWriteJson(path.join(requestWorkspace, "contracts", "semantic-model.json"), semanticModel, { schemaName: "proposalSemanticModel" });
  }
  if (presentationPlan) {
    await validatePresentationPlan(presentationPlan);
    written.presentationPlan = await atomicWriteJson(path.join(requestWorkspace, "contracts", "presentation-plan.json"), presentationPlan, { schemaName: "presentationPlan" });
  }
  written.visualizationSpecs = [];
  for (const spec of visualizationSpecs) {
    written.visualizationSpecs.push(await atomicWriteJson(path.join(requestWorkspace, "contracts", "visualization-specs", `${spec.visualizationSpecId}.json`), spec, { schemaName: "visualizationSpec" }));
  }
  return written;
}

function normalizeFamilyPreferences(styleProfile, allowed, pageNumber, diagnostics) {
  const rows = styleProfile.layoutGrammar?.familyPreferences || [];
  const preferenceMap = new Map();
  for (const row of rows) {
    if (preferenceMap.has(row.family)) throw Object.assign(new Error(`Duplicate layout family preference: ${row.family}`), { code: "LAYOUT_FAMILY_PREFERENCE_DUPLICATE" });
    preferenceMap.set(row.family, Number(row.confidence));
  }
  if (!preferenceMap.size) {
    for (const family of styleProfile.layout?.families || []) preferenceMap.set(family, 0.65);
  }
  for (const family of allowed) {
    if (!preferenceMap.has(family)) {
      preferenceMap.set(family, 0.35);
      diagnostics?.defaultIntroductions.push({ family, pageNumber, defaultProfileId: DEFAULT_PROFILE_ID, defaultProfileVersion: DEFAULT_PROFILE_VERSION, reason: "semantic_page_requirement" });
    }
  }
  return preferenceMap;
}

function geometryPenalty(candidate, previous) {
  if (!candidate || !previous) return 0;
  const a = SILHOUETTES[candidate];
  const b = SILHOUETTES[previous];
  if (!a || !b) return 0;
  const matches = ["columnCount", "heroSide", "dominantAxis", "regionCountBucket"].filter((key) => a[key] === b[key]).length;
  if (matches === 4) return 15;
  if (matches === 3) return 8;
  return 0;
}

function computePlanHash(plan) {
  const payload = JSON.parse(JSON.stringify(plan));
  delete payload.planHash;
  return sha256Digest(canonicalJson(payload));
}

function error(path, message) {
  return { path, keyword: "planning", message, params: {} };
}
