import { canonicalizeTeamPlan, teamCapacitySignature, teamCapacitySignaturesEqual } from "./kp_team_capacity.mjs";
import { sourceOriginKey } from "./kp_source_domains.mjs";

const GROUNDED_TRUTH = new Set(["explicit", "verified", "single_source"]);
const DERIVED_TRUTH = new Set(["recommended", "inferred", "assumed"]);
const UNUSABLE_SOURCE_STATUS = new Set(["blocked", "challenge", "error", "failed", "missing", "unavailable"]);
const PRICE_SPECIFIC_SOURCE_SIGNAL = /^(?:commercial_quote|cost_estimate|cost_model|price_list|price_quote|pricing|pricing_input|project_price|project_quote|quotation|rate_card|rate_sheet|supplier_quote|vendor_quote)$/u;

const ENGLISH_WORDS = new Set([
  "the", "and", "with", "for", "this", "that", "before", "after", "must", "confirm", "confirmed",
  "proposal", "project", "scope", "delivery", "client", "product", "market", "requires", "required",
  "accepted", "acceptance", "evidence", "owner", "payment", "team", "source", "working", "assumption",
  "explicit", "recommended", "remains", "approve", "decision", "decisions", "operating", "system", "user",
  "value", "launch", "commercial", "baseline", "outcome", "outcomes", "through", "from", "into", "only",
]);
const UZBEK_WORDS = new Set([
  "va", "uchun", "bilan", "kerak", "loyiha", "bozor", "mijoz", "foydalanuvchi", "orqali", "bo'yicha",
  "qilinadi", "qilish", "tasdiqlash", "bosqich", "to'lov", "muddat", "jamoa", "narx", "taklif", "tizim",
  "mahsulot", "xizmat", "hamda", "ammo", "yoki", "bu", "bir", "har", "emas", "keyin", "oldin", "ichida",
  "mavjud", "aniqlash", "etiladi", "reja", "doirasida", "bo'ladi", "bo'lishi", "talab", "natija", "egasi",
]);

export function inspectSemanticContentIntegrity({
  requestContext = {},
  proposalModel = {},
  semanticModel = {},
  commercialLock = null,
  presentationPlan = null,
} = {}) {
  if (!hasContentContracts(proposalModel, semanticModel)) return [];
  return dedupeFindings([
    ...inspectClientLanguage({ requestContext, proposalModel, semanticModel, presentationPlan }),
    ...inspectAnalogTruth({ proposalModel, semanticModel }),
    ...inspectRecommendedScope({ proposalModel, semanticModel, commercialLock }),
    ...inspectCommercialPricingProvenance({ proposalModel, semanticModel, commercialLock }),
    ...inspectTeamCapacity({ proposalModel, semanticModel, commercialLock }),
    ...inspectEvidenceTraceability({ proposalModel, semanticModel }),
  ]);
}

export function inspectCommercialPricingProvenance({ proposalModel = {}, semanticModel = {}, commercialLock = null } = {}) {
  const proposalPricing = proposalModel.pricing || {};
  const semanticCommercial = semanticModel.commercial || {};
  const sourceRegistry = commercialSourceRegistry(proposalModel, semanticModel);
  const amountKinds = uniqueStrings([
    proposalPricing.amountKind,
    semanticCommercial.projectAmountKind,
  ]).map((value) => value.toLowerCase());
  const projectPriceSourceIds = commercialEvidenceSourceIds(proposalPricing, semanticCommercial);
  const projectPriceSpecificSourceIds = projectPriceSourceIds.filter((sourceId) => sourceRegistryHasPriceEvidence(sourceRegistry, sourceId));
  const findings = [];

  if (amountKinds.includes("confirmed_quote") && !projectPriceSpecificSourceIds.length) {
    findings.push({
      code: "COMMERCIAL_CONFIRMED_QUOTE_EVIDENCE_MISSING",
      severity: "BLOCKER",
      message: "A project amount is classified as a confirmed quote without directly attached price-specific evidence",
      evidence: {
        amountKinds,
        projectPrice: firstFinite(proposalPricing.projectPrice, proposalPricing.total, semanticCommercial.projectPrice),
        referencedSourceIds: projectPriceSourceIds,
        priceSpecificSourceIds: projectPriceSpecificSourceIds,
      },
      remediation: "Downgrade the amount kind to unknown/planning until the project total cites a usable quote, rate card, pricing input, or other explicitly price-specific source.",
    });
  }

  const budgetAmount = firstPositiveCommercialAmount(
    proposalPricing.budgetAmount,
    proposalModel.groundedBrief?.budget?.amount?.value,
    semanticCommercial.budgetAmount,
  );
  const budgetOnly = budgetAmount > 0
    && !amountKinds.includes("confirmed_quote")
    && projectPriceSpecificSourceIds.length === 0;
  if (!budgetOnly) return findings;

  const functionRows = commercialFunctionRows(proposalModel, semanticModel, commercialLock);
  // A disclosed budget-allocation scenario is sanctioned: it restates the
  // client's own budget as a weighted planning split (formula-based rows that
  // reconcile exactly to the stated budget and carry the scenario rule).
  // The renderer labels every such row as a planning allocation and the page
  // carries a single scenario disclosure — no invented quote is presented.
  const allocationRows = functionRows
    .map((row) => ({ row, amount: commercialFunctionAmount(row, commercialLock) }))
    .filter((entry) => entry.amount > 0);
  const allocationTotal = allocationRows.reduce((sum, entry) => sum + entry.amount, 0);
  const disclosedBudgetAllocation = allocationRows.length >= 2
    && Math.abs(allocationTotal - budgetAmount) < 0.01
    && allocationRows.every(({ row }) => hasFunctionCostBasis(row)
      && /budget(?:[-_])?allocation(?:[-_])?scenario/iu.test(String(row.derivationRuleId || "")));
  if (disclosedBudgetAllocation) return findings;
  const unsupportedRows = functionRows
    .map((row, index) => {
      const amount = commercialFunctionAmount(row, commercialLock);
      if (!(amount > 0)) return null;
      const sourceIds = commercialEvidenceSourceIds(row, row.costModel, row.pricingModel);
      const priceSpecificSourceIds = sourceIds.filter((sourceId) => sourceRegistryHasPriceEvidence(sourceRegistry, sourceId));
      const hasCostBasis = hasFunctionCostBasis(row);
      if (priceSpecificSourceIds.length && hasCostBasis) return null;
      return {
        id: String(row.id || `FP-${String(index + 1).padStart(3, "0")}`),
        amount,
        sourceIds,
        priceSpecificSourceIds,
        derivationRuleId: row.derivationRuleId || null,
        missingRateOrFormula: !hasCostBasis,
        missingCostSpecificProvenance: priceSpecificSourceIds.length === 0,
      };
    })
    .filter(Boolean);
  if (unsupportedRows.length) {
    findings.push({
      code: "COMMERCIAL_BUDGET_REVERSE_ALLOCATION",
      severity: "BLOCKER",
      message: "Budget-only input contains positive function prices without both a rate/formula and cost-specific provenance",
      evidence: {
        budgetAmount,
        amountKinds: amountKinds.length ? amountKinds : ["unspecified"],
        unsupportedRows: unsupportedRows.slice(0, 16),
        unsupportedRowCount: unsupportedRows.length,
      },
      remediation: "Render unknown function costs as unavailable; publish a function amount only after a rate or formula and its usable cost-specific source are attached to that row.",
    });
  }
  return findings;
}

export function inspectClientLanguage({ requestContext = {}, proposalModel = {}, semanticModel = {}, presentationPlan = null } = {}) {
  const expected = expectedLanguage({ requestContext, proposalModel });
  if (!expected) return [];
  const copy = collectClientCopy(proposalModel, semanticModel, presentationPlan);
  const assessment = assessLanguage(copy, expected);
  if (!assessment.mismatch) return [];
  return [{
    code: "CONTENT_LANGUAGE_MISMATCH",
    severity: "WARNING",
    message: `Client-facing proposal copy does not match the source language ${expected.raw}`,
    evidence: {
      expectedLanguage: expected.raw,
      detectedLanguage: assessment.detected,
      wordCount: assessment.wordCount,
      cyrillicRatio: assessment.cyrillicRatio,
      englishSignalCount: assessment.english,
      uzbekSignalCount: assessment.uzbek,
      sample: assessment.sample,
    },
    remediation: "Regenerate all client-facing copy and renderer labels in the brief source language; keep brand names, URLs, numbers, and technical identifiers unchanged.",
  }];
}

export function resolveExpectedClientLanguage({ requestContext = {}, proposalModel = {} } = {}) {
  return expectedLanguage({ requestContext, proposalModel })?.raw || null;
}

export function assessLanguage(value, expected = { code: "en", script: "Latn", raw: "en" }) {
  const cleaned = sanitizeLanguageSample(value);
  const rawWords = cleaned.match(/[\p{L}][\p{L}'’ʻ-]*/gu) || [];
  const words = rawWords.map(normalizeWord).filter((word) => word.length > 1);
  const letters = Array.from(cleaned).filter((char) => /\p{L}/u.test(char));
  const cyrillic = letters.filter((char) => /[А-Яа-яЁёҚқҒғҲҳЎў]/u.test(char)).length;
  const cyrillicRatio = letters.length ? cyrillic / letters.length : 0;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  const uzbek = words.filter((word) => UZBEK_WORDS.has(word) || /(?:o'|g')/.test(word)).length;
  let detected = "undetermined";
  let mismatch = false;
  if (words.length >= 20 && cleaned.length >= 120) {
    if (cyrillicRatio >= 0.28) detected = "ru-or-cyrillic";
    else if (english >= 6 && english > uzbek * 1.5) detected = "en";
    else if (uzbek >= 5 && uzbek >= english * 0.65) detected = "uz-Latn";
    if (expected.code === "uz" && expected.script === "Latn") {
      mismatch = cyrillicRatio >= 0.2 || detected === "en";
    } else if (expected.code === "uz" && expected.script === "Cyrl") {
      mismatch = cyrillicRatio < 0.2 && detected === "en";
    } else if (expected.code === "ru") {
      mismatch = cyrillicRatio < 0.15 && (detected === "en" || detected === "uz-Latn");
    } else if (expected.code === "en") {
      mismatch = cyrillicRatio >= 0.28 || (detected === "uz-Latn" && uzbek > english * 1.3);
    }
  }
  return {
    mismatch,
    detected,
    wordCount: words.length,
    cyrillicRatio: Number(cyrillicRatio.toFixed(3)),
    english,
    uzbek,
    sample: cleaned.slice(0, 220),
  };
}

function inspectAnalogTruth({ proposalModel, semanticModel }) {
  const unknownAnalogs = array(semanticModel.analogs).filter((analog) => analog.truthStatus === "unknown");
  if (!unknownAnalogs.length) return [];
  const claims = array(proposalModel.claimLedger);
  const narrativeRows = [];
  appendStrings(narrativeRows, proposalModel.narrative);
  appendStrings(narrativeRows, proposalModel.groundedNarrative);
  if (typeof proposalModel.problemStatement === "string") narrativeRows.push(proposalModel.problemStatement);
  const validationWording = /\b(?:validated|verified|confirmed|proven)\b|(?:проверен|подтвержд)|(?:tasdiqlangan|tekshirilgan)/iu;
  const conflicts = [];
  for (const analog of unknownAnalogs) {
    const aliases = analogAliases(analog);
    for (const claim of claims) {
      const normalizedClaim = normalizeSearchText(claim.text);
      const mentionsAnalog = aliases.some((alias) => alias.length >= 3 && normalizedClaim.includes(alias));
      if (mentionsAnalog && (claim.truthStatus === "verified" || assertsPositiveValidation(claim.text, validationWording))) {
        conflicts.push({ analogId: analog.id || null, claimId: claim.id || null, label: analog.label || null, source: "claimLedger" });
      }
    }
    narrativeRows.forEach((text, index) => {
      const normalized = normalizeSearchText(text);
      const mentionsAnalog = aliases.some((alias) => alias.length >= 3 && normalized.includes(alias));
      if (mentionsAnalog && assertsPositiveValidation(text, validationWording)) {
        conflicts.push({ analogId: analog.id || null, claimId: null, label: analog.label || null, source: `narrative[${index}]` });
      }
    });
  }
  if (!conflicts.length) return [];
  return [{
    code: "ANALOG_TRUTH_CONTRADICTION",
    severity: "ERROR",
    message: "An analog is marked unvalidated in the semantic model but verified in the claim ledger",
    evidence: { conflicts: conflicts.slice(0, 8), conflictCount: conflicts.length },
    remediation: "Keep the analog claim unknown/single-source until the cited analog evidence is actually usable, or replace the failed evidence.",
  }];
}

function inspectRecommendedScope({ proposalModel, semanticModel, commercialLock }) {
  const proposalRows = array(proposalModel.scope);
  const semanticRows = array(semanticModel.scopeItems);
  const recommendedIds = new Set([
    ...proposalRows.filter(isRecommendedScope).map((row) => String(row.id || "")),
    ...semanticRows.filter(isRecommendedScope).map((row) => String(row.id || "")),
  ].filter(Boolean));
  if (!recommendedIds.size) return [];
  const lockedAsExplicit = array(commercialLock?.explicitScopeRows)
    .filter((row) => recommendedIds.has(String(row.id || "")))
    .map((row) => String(row.id));
  const semanticMislabels = semanticRows
    .filter((row) => recommendedIds.has(String(row.id || "")) && ["confirmed", "explicit", "requested", "supplied"].includes(String(row.inclusion || "").toLowerCase()))
    .map((row) => String(row.id));
  const proposalMislabels = proposalRows
    .filter((row) => recommendedIds.has(String(row.id || "")) && /^(?:confirmed|explicit|requested|supplied)$/i.test(String(row.priority || row.inclusion || "")))
    .map((row) => String(row.id));
  const ids = [...new Set([...lockedAsExplicit, ...semanticMislabels, ...proposalMislabels])];
  if (!ids.length) return [];
  return [{
    code: "SCOPE_RECOMMENDATION_LOCKED_AS_CONFIRMED",
    severity: "BLOCKER",
    message: "Recommended scope is represented as explicit, supplied, requested, or confirmed scope",
    evidence: {
      itemIds: ids.slice(0, 16),
      itemCount: ids.length,
      lockedAsExplicitCount: lockedAsExplicit.length,
      semanticMislabelCount: semanticMislabels.length,
    },
    remediation: "Exclude recommendations from explicitScopeRows and preserve truthStatus=recommended plus inclusion=recommended in every client-visible projection.",
  }];
}

function inspectTeamCapacity({ proposalModel, semanticModel, commercialLock }) {
  const modelTeam = proposalModel.teamPlan || {};
  const lockTeam = commercialLock?.teamPlan || {};
  const semanticTeam = semanticModel.team || {};
  const durationMonths = firstFinite(commercialLock?.durationMonths, proposalModel.durationMonths, semanticModel.project?.durationMonths);
  const multiRoleAllowed = [modelTeam, lockTeam, semanticTeam].some((team) => team.multiRoleStaffing === true
    || team.staffingModel === "multi_role"
    || array(team.personAssignments).length > 0);
  const reasons = [];
  const contracts = [
    ["proposal", modelTeam],
    ["lock", lockTeam],
    ["semantic", semanticTeam],
  ].filter(([, team]) => team && Object.keys(team).length);
  const canonicalByContract = [];
  for (const [label, team] of contracts) {
    try {
      const canonical = canonicalizeTeamPlan(team, { durationMonths });
      const allocations = array(team.roleAllocations).length
        ? team.roleAllocations
        : array(team.roles).filter((row) => row && typeof row === "object");
      if (allocations.length) {
        if (Number(team.monthCount) !== canonical.monthCount) reasons.push(`${label}_month_count_mismatch`);
        if (!sameNumbers(team.monthlyTotals, canonical.monthlyTotals)) reasons.push(`${label}_monthly_totals_mismatch`);
        if ((team.peakMonth ?? null) !== canonical.peakMonth) reasons.push(`${label}_peak_month_mismatch`);
        if (!sameNumber(team.peakFte, canonical.peakFte)) reasons.push(`${label}_aggregate_peak_mismatch`);
        if (!sameNumber(team.fteMonths, canonical.fteMonths)) reasons.push(`${label}_aggregate_fte_months_mismatch`);
      }
      allocations.forEach((row, index) => {
        const expected = canonical.roleAllocations[index];
        if (!expected || String(row.role || row.name || "") !== expected.role) {
          reasons.push(`${label}_role_${index + 1}_inventory_mismatch`);
          return;
        }
        if (!sameNumbers(row.monthlyFte, expected.monthlyFte)) reasons.push(`${label}_role_${index + 1}_monthly_mismatch`);
        if (!sameNumber(row.peakFte, expected.peakFte)) reasons.push(`${label}_role_${index + 1}_peak_mismatch`);
        if (!sameNumber(row.fteMonths, expected.fteMonths)) reasons.push(`${label}_role_${index + 1}_fte_months_mismatch`);
      });
      if (canonical.people + 0.0005 < canonical.peakFte) reasons.push(`${label}_aggregate_peak_exceeds_people`);
      const minimumNamedHeadcount = canonical.roleAllocations.reduce((sum, row) => sum + Math.ceil(Number(row.peakFte || 0)), 0);
      if (!multiRoleAllowed && canonical.people < minimumNamedHeadcount) reasons.push(`${label}_people_below_named_role_minimum`);
      if (durationMonths && canonical.fteMonths > canonical.people * durationMonths + 0.0005) reasons.push(`${label}_fte_months_exceed_people_capacity`);
      canonicalByContract.push([label, canonical, teamCapacitySignature(canonical, { durationMonths })]);
    } catch (error) {
      reasons.push(`${label}_capacity_invalid`);
    }
  }
  for (let index = 1; index < canonicalByContract.length; index += 1) {
    if (!teamCapacitySignaturesEqual(canonicalByContract[0][2], canonicalByContract[index][2])) {
      reasons.push(`${canonicalByContract[0][0]}_${canonicalByContract[index][0]}_mismatch`);
    }
  }
  if (!reasons.length) return [];
  const canonical = canonicalByContract.find(([label]) => label === "lock")?.[1] || canonicalByContract[0]?.[1] || {};
  return [{
    code: "TEAM_HEADCOUNT_PEAK_FTE_MISMATCH",
    severity: "ERROR",
    message: "Team monthly capacity, role peaks, FTE-months, or aggregate peak does not reconcile",
    evidence: {
      people: canonical.people ?? null,
      peakFte: canonical.peakFte ?? null,
      fteMonths: canonical.fteMonths ?? null,
      durationMonths,
      monthCount: canonical.monthCount ?? null,
      monthlyTotals: canonical.monthlyTotals || [],
      reasons: [...new Set(reasons)].slice(0, 12),
    },
    remediation: "Use one canonical monthlyFte matrix across ProposalModel, CommercialLock, SemanticModel, Team Size and Project Price; derive every role peak, FTE-month total and aggregate peak from it.",
  }];
}

function sameNumber(actual, expected, epsilon = 0.0005) {
  const parsed = finite(actual);
  return parsed !== null && Math.abs(parsed - Number(expected)) <= epsilon;
}

function sameNumbers(actual, expected, epsilon = 0.0005) {
  return array(actual).length === array(expected).length
    && array(actual).every((value, index) => sameNumber(value, expected[index], epsilon));
}

function inspectEvidenceTraceability({ proposalModel, semanticModel }) {
  const sources = [...array(proposalModel.sources), ...array(semanticModel.sources)];
  const sourceById = new Map(sources.filter((source) => source?.id).map((source) => [String(source.id), source]));
  const references = [];
  collectEvidenceReferences(proposalModel, "proposalModel", references, new WeakSet());
  collectEvidenceReferences(semanticModel, "semanticModel", references, new WeakSet());
  const missing = new Map();
  for (const reference of references) {
    if (!sourceById.has(reference.sourceId)) {
      if (!missing.has(reference.sourceId)) missing.set(reference.sourceId, []);
      missing.get(reference.sourceId).push(reference.path);
    }
  }
  const findings = [];
  if (missing.size) {
    findings.push({
      code: "EVIDENCE_SOURCE_UNRESOLVED",
      severity: "ERROR",
      message: "One or more evidence references do not resolve to the persisted source registry",
      evidence: {
        missingSourceIds: [...missing.keys()].slice(0, 16),
        missingSourceCount: missing.size,
        samplePaths: [...missing.entries()].slice(0, 8).map(([sourceId, paths]) => ({ sourceId, paths: paths.slice(0, 4) })),
      },
      remediation: "Persist every referenced source under the exact source ID, or remove the unsupported truth claim.",
    });
  }
  const claimProblems = [];
  const verifiedDomainProblems = [];
  for (const claim of array(proposalModel.claimLedger)) {
    const sourceIds = array(claim.sourceIds).map(String);
    const truth = String(claim.truthStatus || "unknown");
    if (GROUNDED_TRUTH.has(truth) && !sourceIds.length) claimProblems.push({ claimId: claim.id || null, reason: "grounded_truth_without_source" });
    if (truth === "single_source" && sourceIds.length !== 1) claimProblems.push({ claimId: claim.id || null, reason: "single_source_count_mismatch" });
    if (DERIVED_TRUTH.has(truth) && !sourceIds.length && !claim.derivationRuleId) claimProblems.push({ claimId: claim.id || null, reason: "derived_truth_without_rule" });
    if (GROUNDED_TRUTH.has(truth) && sourceIds.some((sourceId) => unusableSourceStatus(sourceById.get(sourceId)?.status))) {
      claimProblems.push({ claimId: claim.id || null, reason: "grounded_claim_uses_unusable_source" });
    }
    if (truth === "verified") {
      const sourceDomains = sourceIds.map((sourceId) => ({
        sourceId,
        registrableDomain: sourceOriginKey(sourceById.get(sourceId), sourceId),
      }));
      const independentDomains = [...new Set(sourceDomains.map((row) => row.registrableDomain).filter(Boolean))];
      if (independentDomains.length < 2) {
        verifiedDomainProblems.push({
          claimId: claim.id || null,
          sourceIds,
          registrableDomains: independentDomains,
          sourceIdsWithoutRegistrableDomain: sourceDomains.filter((row) => !row.registrableDomain).map((row) => row.sourceId),
          independentDomainCount: independentDomains.length,
        });
      }
    }
  }
  if (claimProblems.length) {
    findings.push({
      code: "EVIDENCE_CLAIM_UNTRACED",
      severity: "ERROR",
      message: "A claim truth status lacks the source or derivation provenance it requires",
      evidence: { problems: claimProblems.slice(0, 16), problemCount: claimProblems.length },
      remediation: "Downgrade the truth status or attach resolvable evidence/derivation provenance.",
    });
  }
  if (verifiedDomainProblems.length) {
    findings.push({
      code: "EVIDENCE_VERIFIED_SOURCES_NOT_INDEPENDENT",
      severity: "ERROR",
      message: "A verified claim does not cite at least two independent registrable domains",
      evidence: { problems: verifiedDomainProblems.slice(0, 16), problemCount: verifiedDomainProblems.length },
      remediation: "Downgrade the claim to single_source or attach supporting evidence from at least two independent registrable domains.",
    });
  }
  return findings;
}

function unusableSourceStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (UNUSABLE_SOURCE_STATUS.has(status)) return true;
  return /^(?:blocked|challenge|error|failed|missing|unavailable|unreadable|empty)(?:\b|:)/u.test(status);
}

function expectedLanguage({ requestContext, proposalModel }) {
  const raw = proposalModel.groundedBrief?.sourceLanguage
    || requestContext.sourceLanguage
    || proposalModel.brief?.sourceLanguage
    || proposalModel.brief?.locale
    || requestContext.locale;
  if (!raw) return null;
  const normalized = String(raw).toLowerCase();
  if (normalized.startsWith("uz")) return { code: "uz", script: /cyrl/.test(normalized) ? "Cyrl" : "Latn", raw: String(raw) };
  if (normalized.startsWith("ru")) return { code: "ru", script: "Cyrl", raw: String(raw) };
  if (normalized.startsWith("en")) return { code: "en", script: "Latn", raw: String(raw) };
  return null;
}

function collectClientCopy(proposalModel, semanticModel, presentationPlan) {
  const pieces = [];
  appendStrings(pieces, proposalModel.narrative);
  appendStrings(pieces, proposalModel.groundedNarrative);
  appendStrings(pieces, {
    problemStatement: proposalModel.problemStatement,
    solutionNarrative: proposalModel.solutionNarrative,
  });
  for (const analog of array(semanticModel.analogs)) pieces.push(analog.learning || "");
  for (const row of array(semanticModel.swot)) pieces.push(row.label || "", row.response || "");
  for (const row of array(semanticModel.risks)) pieces.push(row.label || "", row.detail || "", row.response || "");
  for (const row of array(semanticModel.market?.methodology)) pieces.push(typeof row === "string" ? row : "");
  for (const page of array(presentationPlan?.pages)) pieces.push(page.title || "", page.subtitle || "");
  return pieces.filter(Boolean).join(" ");
}

function sanitizeLanguageSample(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/https?:\/\/\S+|www\.\S+|\b\S+@\S+\.\S+\b/giu, " ")
    .replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)*\b/g, " ")
    .replace(/[0-9]+(?:[.,][0-9]+)?/g, " ")
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

function normalizeWord(value) {
  return String(value).toLowerCase().replace(/[’ʻ`]/g, "'").replace(/^-+|-+$/g, "");
}

function analogAliases(analog) {
  const values = [analog.label, analog.name, analog.title, analog.url].filter(Boolean);
  const aliases = new Set();
  for (const value of values) {
    let text = String(value);
    try {
      const url = new URL(text);
      text = url.hostname.replace(/^www\./i, "");
    } catch {}
    const normalized = normalizeSearchText(text);
    if (normalized) aliases.add(normalized);
    const first = normalized.split(" ")[0];
    if (first?.length >= 4) aliases.add(first);
  }
  return [...aliases];
}

function assertsPositiveValidation(value, validationWording) {
  const text = String(value || "");
  if (!validationWording.test(text)) return false;
  const negated = /\b(?:not|never|cannot|can't|could not|has not|have not|was not|is not)(?:\s+\w+){0,3}\s+(?:validated|verified|confirmed|proven)\b|\b(?:unvalidated|unverified)\b|(?:не\s+(?:был[аио]?\s+)?(?:проверен|подтвержд))|(?:tasdiqlanmagan|tekshirilmagan)/iu;
  return !negated.test(text);
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isRecommendedScope(row = {}) {
  return row.truthStatus === "recommended"
    || row.inclusion === "recommended"
    || /^recommended$/i.test(String(row.priority || ""));
}

function collectEvidenceReferences(value, path, output, seen) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectEvidenceReferences(item, `${path}[${index}]`, output, seen));
    return;
  }
  if (Array.isArray(value.sourceIds)) {
    value.sourceIds.forEach((sourceId) => {
      if (sourceId) output.push({ sourceId: String(sourceId), path: `${path}.sourceIds` });
    });
  }
  if (Array.isArray(value.evidenceRefs)) {
    value.evidenceRefs.forEach((reference, index) => {
      if (reference?.sourceId) output.push({ sourceId: String(reference.sourceId), path: `${path}.evidenceRefs[${index}].sourceId` });
    });
  }
  for (const [key, child] of Object.entries(value)) {
    if (["sources", "sourceIds", "evidenceRefs"].includes(key)) continue;
    collectEvidenceReferences(child, `${path}.${key}`, output, seen);
  }
}

function commercialSourceRegistry(proposalModel, semanticModel) {
  const registry = new Map();
  for (const source of [...array(proposalModel.sources), ...array(semanticModel.sources)]) {
    const sourceId = String(source?.id || "").trim();
    if (!sourceId) continue;
    if (!registry.has(sourceId)) registry.set(sourceId, []);
    registry.get(sourceId).push(source);
  }
  return registry;
}

function sourceRegistryHasPriceEvidence(registry, sourceId) {
  return array(registry.get(String(sourceId))).some((source) => {
    if (unusableSourceStatus(source?.status)) return false;
    if (source?.priceSpecific === true || source?.costSpecific === true) return true;
    const signals = [
      source?.type,
      source?.evidenceType,
      source?.evidenceRole,
      source?.researchTopic,
      source?.topic,
      source?.category,
      source?.purpose,
      source?.commercialEvidenceKind,
      source?.provenanceType,
      ...array(source?.tags),
    ];
    return signals.some((value) => PRICE_SPECIFIC_SOURCE_SIGNAL.test(normalizeCommercialSignal(value)));
  });
}

function normalizeCommercialSignal(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function commercialEvidenceSourceIds(...values) {
  const ids = [];
  const append = (value) => {
    if (typeof value === "string" && value.trim()) {
      ids.push(value.trim());
      return;
    }
    if (value && typeof value === "object" && typeof value.sourceId === "string" && value.sourceId.trim()) {
      ids.push(value.sourceId.trim());
    }
  };
  for (const value of values.filter((item) => item && typeof item === "object")) {
    for (const key of ["sourceIds", "priceSourceIds", "projectPriceSourceIds", "projectQuoteSourceIds", "quoteSourceIds", "costSourceIds", "rateSourceIds"]) {
      for (const item of array(value[key])) append(item);
    }
    for (const key of ["evidenceRefs", "priceEvidenceRefs", "projectPriceEvidenceRefs", "quoteEvidenceRefs", "costEvidenceRefs", "rateEvidenceRefs"]) {
      for (const item of array(value[key])) append(item);
    }
    for (const key of ["priceEvidence", "quoteEvidence", "costEvidence", "rateEvidence"]) {
      const evidence = value[key];
      if (Array.isArray(evidence)) evidence.forEach(append);
      else append(evidence);
    }
  }
  return uniqueStrings(ids);
}

function commercialFunctionRows(proposalModel, semanticModel, commercialLock) {
  const proposalRows = array(proposalModel.functionPrice);
  if (proposalRows.length) return proposalRows;
  const semanticRows = array(semanticModel.commercial?.functionPrice);
  if (semanticRows.length) return semanticRows;
  return array(commercialLock?.functionPrice);
}

function commercialFunctionAmount(row, commercialLock) {
  if (row?.amountMinor !== undefined && row?.amountMinor !== null) {
    const exponent = Number(commercialLock?.currencyExponent ?? 2);
    return Number(row.amountMinor) / (10 ** exponent);
  }
  return firstCommercialAmount(row?.total, row?.amount, row?.price, row?.value) ?? 0;
}

function hasFunctionCostBasis(row) {
  const models = [row, row?.costModel, row?.pricingModel].filter((value) => value && typeof value === "object");
  const formula = models
    .flatMap((value) => [value.formula, value.costFormula, value.pricingFormula, value.calculation])
    .find((value) => typeof value === "string" && value.trim());
  if (formula) return true;
  for (const model of models) {
    const rate = firstPositive(model.rate, model.unitRate, model.hourlyRate, model.dailyRate, model.monthlyRate);
    const quantity = firstPositive(model.quantity, model.hours, model.days, model.units, model.effort, model.fteMonths);
    if (rate > 0 && quantity > 0) return true;
  }
  const rule = normalizeCommercialSignal(row?.derivationRuleId);
  if (!rule || /(?:^|_)(?:allocation|budget|reverse|share|percent|percentage)(?:_|$)/u.test(rule)) return false;
  return /(?:^|_)(?:cost|price|pricing|quote|rate)(?:_|$)/u.test(rule)
    && /(?:^|_)(?:calc|calculation|estimate|effort|formula|hours|model|quote|rate|units)(?:_|$)/u.test(rule);
}

function appendStrings(output, value) {
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) if (typeof item === "string") output.push(item);
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number !== null) return number;
  }
  return null;
}

function firstPositive(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number !== null && number > 0) return number;
  }
  return 0;
}

function firstCommercialAmount(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(String(value).replace(/[$,\s]/gu, ""));
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function firstPositiveCommercialAmount(...values) {
  for (const value of values) {
    const number = firstCommercialAmount(value);
    if (number !== null && number > 0) return number;
  }
  return 0;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function array(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function uniqueStrings(values) {
  return [...new Set(array(values).map((value) => String(value || "").trim()).filter(Boolean))];
}

function hasContentContracts(proposalModel, semanticModel) {
  return Object.keys(proposalModel || {}).length > 0 || Object.keys(semanticModel || {}).length > 0;
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.code}:${finding.page || ""}:${JSON.stringify(finding.evidence || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
