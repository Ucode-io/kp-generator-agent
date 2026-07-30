import { commercialLockHash, validateKpContract } from "./kp_reference_contracts.mjs";
import { canonicalizeTeamPlan } from "./kp_team_capacity.mjs";

const EXPLICIT_TRUTH = new Set(["explicit", "verified", "single_source"]);
const DERIVED_TRUTH = new Set(["recommended", "inferred", "assumed"]);
const PROCESS_REF_COLLECTIONS = Object.freeze(["tasks", "events", "states", "decisions"]);
const ENTITY_REF_COLLECTIONS = Object.freeze(["actors", "capabilities", "tasks", "events", "states", "decisions", "integrations", "dataStores", "scopeItems"]);

export function normalizeScopeItems(scope = []) {
  return array(scope).map((item, index) => {
    const row = Array.isArray(item)
      ? { epic: item[0], feature: item[1], detail: item[2], phase: item[3], priority: item[4] }
      : item || {};
    const text = [row.epic, row.feature, row.detail, row.phase, row.priority, row.inclusion, row.ownership].join(" ");
    const inclusion = normalizeInclusion(row.inclusion) || inclusionFromText(text);
    const ownership = normalizeOwnership(row.ownership) || ownershipFromText(text);
    const truthStatus = normalizeTruth(row.truthStatus) || truthFromText(text);
    const id = row.id || `SCOPE-${String(index + 1).padStart(3, "0")}`;
    const feature = clean(row.feature || row.name || row.title || row.epic || `Scope ${index + 1}`);
    return {
      id,
      label: feature,
      epic: clean(row.epic || row.module || row.domain || "Scope"),
      feature,
      detail: clean(row.detail || row.description || ""),
      priority: clean(row.priority || ""),
      capabilityIds: array(row.capabilityIds).length ? array(row.capabilityIds).map(String) : [id.replace(/^SCOPE/, "CAP")],
      inclusion,
      ownership,
      phaseId: row.phaseId || phaseIdFromText(row.phase) || null,
      truthStatus,
      sourceIds: sourceIdsFor(row, truthStatus),
      derivationRuleId: derivationRuleFor(row, truthStatus),
    };
  });
}

export function normalizeRoadmapItems(roadmap = [], { durationMonths = 0, durationWeeks = 0 } = {}) {
  const rows = array(roadmap);
  if (!rows.length) {
    return [{
      id: "PHASE-1",
      label: "Delivery",
      time: { unit: "week", start: 1, end: Math.max(1, durationWeeks || Math.round((durationMonths || 1) * 4)) },
      inclusion: "recommended",
      truthStatus: "assumed",
      sourceIds: [],
      derivationRuleId: "V5-ROADMAP-PLANNING-SCENARIO",
    }];
  }
  return rows.map((item, index) => {
    const row = Array.isArray(item) ? { label: item[1] || item[0], phase: item[0], months: item[2] } : item || {};
    const hasWeek = row.startWeek || row.endWeek || row.unit === "week";
    const unit = "week";
    const rawStart = Number(row.start ?? row.startMonth ?? row.startWeek ?? index + 1);
    const rawEnd = Number(row.end ?? row.endMonth ?? row.endWeek ?? row.month ?? row.months ?? rawStart);
    const start = hasWeek ? rawStart : ((rawStart - 1) * 4) + 1;
    const end = hasWeek ? rawEnd : rawEnd * 4;
    const truthStatus = normalizeTruth(row.truthStatus) || truthFromText(JSON.stringify(row));
    return {
      id: row.id || `PHASE-${index + 1}`,
      label: clean(row.label || row.title || row.phase || `Phase ${index + 1}`),
      time: { unit, start, end: Math.max(start, end) },
      inclusion: normalizeInclusion(row.inclusion) || (DERIVED_TRUTH.has(truthStatus) ? "recommended" : "in_scope"),
      truthStatus,
      sourceIds: sourceIdsFor(row, truthStatus),
      derivationRuleId: derivationRuleFor(row, truthStatus),
    };
  });
}

export function normalizeSwotItems(swot = {}) {
  if (Array.isArray(swot)) {
    return swot.map((item, index) => {
      if (Array.isArray(item)) {
        return swotRow({
          label: item[1] || item[0],
          truthStatus: "recommended",
          derivationRuleId: "SWOT-SYNTHESIS-V1",
        }, normalizeSwotQuadrant(item[0]), index);
      }
      return swotRow(item, normalizeSwotQuadrant(item?.quadrant), index);
    });
  }
  return Object.entries(swot || {}).flatMap(([quadrant, values]) => array(values).map((value, index) => swotRow(value, normalizeSwotQuadrant(quadrant), index)));
}

export function normalizePaymentItems(payments = []) {
  return array(payments).map((item, index) => {
    const truthStatus = normalizeTruth(item?.truthStatus) || "unknown";
    return {
      id: item.id || `PAYMENT-${String(index + 1).padStart(3, "0")}`,
      label: clean(item.name || item.label || `Payment ${index + 1}`),
      amount: moneyNumber(item.amount ?? item.total ?? 0),
      percent: Number(item.percent ?? item.percentage ?? 0),
      truthStatus,
      sourceIds: sourceIdsFor(item, truthStatus),
      derivationRuleId: derivationRuleFor(item, truthStatus),
    };
  });
}

export function normalizeTeamItems(teamPlan = {}, { durationMonths = null } = {}) {
  const canonicalTeam = canonicalizeTeamPlan(teamPlan, { durationMonths });
  const rows = array(canonicalTeam.roleAllocations).length
    ? canonicalTeam.roleAllocations
    : array(teamPlan.roles).length
      ? teamPlan.roles
      : teamPlan.team;
  return array(rows).map((item, index) => {
    const row = typeof item === "string" ? { role: item } : item || {};
    const truthStatus = normalizeTruth(row.truthStatus) || normalizeTruth(teamPlan.truthStatus) || "unknown";
    return {
      id: row.id || `ROLE-${String(index + 1).padStart(3, "0")}`,
      role: clean(row.role || row.name || `Role ${index + 1}`),
      people: nullableNumber(row.people ?? row.qty ?? row.count),
      fteMonths: nullableNumber(row.fteMonths),
      peakFte: nullableNumber(row.peakFte ?? row.fte ?? row.qty),
      monthlyFte: array(row.monthlyFte).map(Number),
      truthStatus,
      sourceIds: array(row.sourceIds).length ? array(row.sourceIds).map(String) : sourceIdsFor(teamPlan, truthStatus),
      derivationRuleId: row.derivationRuleId || derivationRuleFor(teamPlan, truthStatus),
    };
  });
}

export function buildProposalSemanticModel(proposalModel = {}, options = {}) {
  const requestId = options.requestId || proposalModel.requestId || "KP-20260713-LOCAL01";
  const lockHash = proposalModel.commercialLockHash || commercialLockHash(proposalModel);
  const scopeItems = normalizeScopeItems(proposalModel.scope || proposalModel.functionPrice || []);
  const capabilities = scopeItems.map((item) => capabilityFromScope(item, scopeItems));
  const roadmapMonthEnd = inferRoadmapEndMonth(proposalModel.roadmap || []);
  const durationMonths = Number(proposalModel.timeline?.durationMonths || proposalModel.brief?.durationMonths || proposalModel.durationMonths || roadmapMonthEnd || 3);
  const durationWeeks = Number(proposalModel.timeline?.durationWeeks || proposalModel.brief?.durationWeeks || proposalModel.durationWeeks || Math.max(1, Math.round(durationMonths * 4)));
  const phases = normalizeRoadmapItems(proposalModel.roadmap || [], { durationMonths, durationWeeks });
  const canonicalTeam = canonicalizeTeamPlan(proposalModel.teamPlan || {}, { durationMonths });
  const teamRoles = normalizeTeamItems(canonicalTeam, { durationMonths });
  const payments = normalizePaymentItems(proposalModel.payments || []);
  const functionPrice = normalizeFunctionPriceItems(proposalModel.functionPrice || []);
  const projectPrice = moneyNumber(proposalModel.pricing?.projectPrice ?? proposalModel.pricing?.total ?? functionPrice.reduce((sum, row) => sum + row.amount, 0));
  const projectAmountKind = normalizeProjectAmountKind(proposalModel.pricing?.amountKind);
  const budgetAmount = moneyNumber(proposalModel.pricing?.budgetAmount ?? proposalModel.groundedBrief?.budget?.amount?.value ?? 0);
  const budgetCurrency = nullableText(proposalModel.pricing?.budgetCurrency || proposalModel.groundedBrief?.budget?.currency?.value);
  const budgetAmountTruthStatus = normalizeTruth(proposalModel.pricing?.budgetAmountTruthStatus || proposalModel.groundedBrief?.budget?.amount?.status) || "unknown";
  const budgetCurrencyTruthStatus = normalizeTruth(proposalModel.pricing?.budgetCurrencyStatus || proposalModel.groundedBrief?.budget?.currency?.status) || "unknown";
  const projectPriceTruthStatus = normalizeTruth(proposalModel.pricing?.amountTruthStatus || proposalModel.pricing?.truthStatus)
    || (projectAmountKind === "budget_constraint" ? "assumed" : "unknown");
  const projectPriceSourceIds = unique([
    ...array(proposalModel.pricing?.sourceIds).map(String),
    ...array(proposalModel.groundedBrief?.budget?.amount?.evidenceRefs).map((row) => row?.sourceId).filter(Boolean),
  ]);
  const durationTruthStatus = normalizeTruth(proposalModel.groundedBrief?.timeline?.months?.status)
    || normalizeTruth(proposalModel.timeline?.truthStatus)
    || "unknown";
  const durationSourceIds = unique(array(proposalModel.groundedBrief?.timeline?.months?.evidenceRefs).map((row) => row?.sourceId).filter(Boolean));
  const locale = proposalModel.groundedBrief?.sourceLanguage || proposalModel.brief?.locale || options.locale || "en";
  const projectSourceIds = unique(array(proposalModel.sources)
    .filter((source) => source?.id && /client[_ -]?brief|client[_ -]?request|prompt/i.test(`${source.type || ""} ${source.label || ""}`))
    .map((source) => String(source.id)));
  const actors = buildTemplateActors(proposalModel, scopeItems, locale);
  const recommendedProcess = buildRecommendedPrimaryProcess(proposalModel, actors, locale);
  const integrations = buildIntegrations(scopeItems);
  const dataStores = buildDataStores(scopeItems, locale);
  const projectName = proposalModel.brief?.projectName || proposalModel.title || "Product";
  const architecture = buildArchitecture({ capabilities, integrations, dataStores, scopeItems, projectName, locale, actors });
  const model = {
    schemaVersion: "1.0",
    semanticModelId: `PSM-${requestId}`,
    requestId,
    status: scopeItems.some((item) => item.truthStatus !== "explicit") || actors.length ? "grounded_with_recommendations" : "grounded",
    commercialLockHash: lockHash,
    project: {
      id: proposalModel.projectId || "PROJECT-CUSTOM",
      name: proposalModel.brief?.projectName || proposalModel.title || "Commercial proposal",
      category: proposalModel.brief?.type || "digital_product",
      durationMonths,
      durationWeeks,
      durationTruthStatus,
      durationSourceIds,
      durationDerivationRuleId: DERIVED_TRUTH.has(durationTruthStatus) ? "DURATION-NORMALIZER-V1" : null,
      // The persisted source registry uses deterministic request-specific IDs.
      // Never synthesize a generic SRC-PROMPT reference that cannot resolve in
      // the proposal package and content QA.
      sourceIds: projectSourceIds,
    },
    actors,
    capabilities,
    tasks: recommendedProcess.tasks,
    scopeItems,
    events: recommendedProcess.events,
    states: recommendedProcess.states,
    decisions: recommendedProcess.decisions,
    integrations,
    dataStores,
    processes: recommendedProcess.processes,
    processRelations: recommendedProcess.processRelations,
    ownership: {
      ownedCapabilityIds: scopeItems.filter((item) => item.ownership === "owned").flatMap((item) => item.capabilityIds),
      partnerIntegrationIds: integrations.map((item) => item.id),
      deferredCapabilityIds: scopeItems.filter((item) => item.ownership === "deferred").flatMap((item) => item.capabilityIds),
    },
    primaryProcessId: recommendedProcess.primaryProcessId,
    architecture,
    market: buildMarket(proposalModel),
    roadmap: {
      durationMonths,
      durationWeeks,
      timeScale: { unit: "week", start: 1, end: Math.max(1, durationWeeks) },
      phases,
      dependencies: normalizeRoadmapDependencies(proposalModel.roadmapDependencies || [], phases),
    },
    team: {
      people: nullableNumber(canonicalTeam.people),
      roles: teamRoles,
      monthCount: canonicalTeam.monthCount,
      monthlyTotals: canonicalTeam.monthlyTotals,
      peakMonth: canonicalTeam.peakMonth,
      fteMonths: nullableNumber(canonicalTeam.fteMonths),
      peakFte: nullableNumber(canonicalTeam.peakFte),
      sourceIds: teamRoles.length ? unique(teamRoles.flatMap((row) => row.sourceIds)) : [],
      truthStatus: normalizeTruth(canonicalTeam.truthStatus) || (teamRoles.some((row) => EXPLICIT_TRUTH.has(row.truthStatus)) ? "single_source" : teamRoles.some((row) => DERIVED_TRUTH.has(row.truthStatus)) ? "assumed" : "unknown"),
      derivationRuleId: canonicalTeam.derivationRuleId || (teamRoles.some((row) => DERIVED_TRUTH.has(row.truthStatus)) ? "TEAM-PLAN-NORMALIZER-V1" : null),
    },
    commercial: {
      commercialLockHash: lockHash,
      currency: proposalModel.pricing?.currency || options.currency || "XXX",
      projectPrice,
      projectAmountKind,
      projectPriceTruthStatus,
      projectPriceSourceIds,
      projectPriceDerivationRuleId: proposalModel.pricing?.derivationRuleId || (DERIVED_TRUTH.has(projectPriceTruthStatus) ? "PROJECT-PRICE-MODEL-V1" : null),
      budgetAmount,
      budgetCurrency,
      budgetAmountTruthStatus,
      budgetCurrencyTruthStatus,
      functionPrice,
      payments,
    },
    analogs: normalizeAnalogs(proposalModel.analogs || proposalModel.analogResearch || proposalModel.benchmarks || [], proposalModel.sources || []),
    swot: normalizeSwotItems(proposalModel.swot || {}),
    risks: normalizeRisks(proposalModel.risks || []),
    scope: { scopeItems, capabilities },
    sources: proposalModel.sources || [],
    warnings: [],
  };
  return model;
}

function normalizeProjectAmountKind(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["budget_constraint", "confirmed_quote", "planning_total"].includes(normalized) ? normalized : "unknown";
}

export async function validateProposalSemanticModel(model, options = {}) {
  const schemaResult = await validateKpContract("proposalSemanticModel", model, options);
  if (!schemaResult.ok) return schemaResult;
  const semanticErrors = validateSemanticReferences(model);
  if (semanticErrors.length) {
    if (options.throwOnError === false) return { ok: false, errors: semanticErrors };
    throw Object.assign(new Error(`Proposal semantic model failed semantic validation: ${semanticErrors.map((error) => `${error.path} ${error.message}`).join("; ")}`), {
      code: "PROPOSAL_SEMANTIC_MODEL_INVALID",
      errors: semanticErrors,
    });
  }
  return schemaResult;
}

export function validateSemanticReferences(model = {}) {
  const errors = [];
  const idsByCollection = {
    actors: idSet(model.actors),
    capabilities: idSet(model.capabilities),
    tasks: idSet(model.tasks),
    events: idSet(model.events),
    states: idSet(model.states),
    decisions: idSet(model.decisions),
    integrations: idSet(model.integrations),
    dataStores: idSet(model.dataStores),
    scopeItems: idSet(model.scopeItems),
  };
  for (const [collection, rows] of Object.entries(idsByCollection)) {
    if (rows.duplicates.length) errors.push(error(`/${collection}`, `duplicate IDs: ${rows.duplicates.join(", ")}`));
  }
  forEachEnvelope(model, (row, path) => {
    if (EXPLICIT_TRUTH.has(row.truthStatus) && !array(row.sourceIds).length) errors.push(error(`${path}/sourceIds`, `${row.truthStatus} rows require sourceIds`));
    if (DERIVED_TRUTH.has(row.truthStatus) && !array(row.sourceIds).length && !row.derivationRuleId) errors.push(error(`${path}/derivationRuleId`, `${row.truthStatus} rows require sourceIds or derivationRuleId`));
  });
  validateProvenanceRow({
    truthStatus: model.project?.durationTruthStatus,
    sourceIds: model.project?.durationSourceIds,
    derivationRuleId: model.project?.durationDerivationRuleId,
  }, "/project/duration", errors);
  validateProvenanceRow({
    truthStatus: model.team?.truthStatus,
    sourceIds: model.team?.sourceIds,
    derivationRuleId: model.team?.derivationRuleId,
  }, "/team", errors);
  for (const [index, row] of array(model.team?.roles).entries()) validateProvenanceRow(row, `/team/roles/${index}`, errors);
  validateProvenanceRow({
    truthStatus: model.commercial?.projectPriceTruthStatus,
    sourceIds: model.commercial?.projectPriceSourceIds,
    derivationRuleId: model.commercial?.projectPriceDerivationRuleId,
  }, "/commercial/projectPrice", errors);
  for (const [index, row] of array(model.commercial?.functionPrice).entries()) validateProvenanceRow(row, `/commercial/functionPrice/${index}`, errors);
  for (const [index, row] of array(model.commercial?.payments).entries()) validateProvenanceRow(row, `/commercial/payments/${index}`, errors);
  for (const [index, item] of array(model.scopeItems).entries()) {
    for (const capabilityId of item.capabilityIds || []) {
      if (!idsByCollection.capabilities.set.has(capabilityId)) errors.push(error(`/scopeItems/${index}/capabilityIds`, `unknown capability: ${capabilityId}`));
    }
    if (item.phaseId && !array(model.roadmap?.phases).some((phase) => phase.id === item.phaseId)) errors.push(error(`/scopeItems/${index}/phaseId`, `unknown phase: ${item.phaseId}`));
  }
  const primaryProcesses = array(model.processes).filter((process) => process.type === "primary");
  if (primaryProcesses.length > 1) errors.push(error("/processes", "at most one primary process is allowed"));
  if (model.primaryProcessId) {
    const primary = primaryProcesses.find((process) => process.id === model.primaryProcessId);
    if (!primary) errors.push(error("/primaryProcessId", "must reference a primary process"));
  }
  const relationIds = idSet(model.processRelations);
  for (const [index, relation] of array(model.processRelations).entries()) {
    validateProcessRef(relation.fromRef, `/processRelations/${index}/fromRef`, idsByCollection, errors);
    validateProcessRef(relation.toRef, `/processRelations/${index}/toRef`, idsByCollection, errors);
  }
  for (const [index, process] of array(model.processes).entries()) {
    for (const nodeRef of process.nodeRefs || []) validateProcessRef(nodeRef, `/processes/${index}/nodeRefs`, idsByCollection, errors);
    for (const relationId of process.relationIds || []) if (!relationIds.set.has(relationId)) errors.push(error(`/processes/${index}/relationIds`, `unknown process relation: ${relationId}`));
    for (const actorId of process.actorIds || []) if (!idsByCollection.actors.set.has(actorId)) errors.push(error(`/processes/${index}/actorIds`, `unknown actor: ${actorId}`));
  }
  const componentIds = idSet(model.architecture?.components || []);
  for (const [index, component] of array(model.architecture?.components).entries()) {
    if (component.entityRef) validateEntityRef(component.entityRef, `/architecture/components/${index}/entityRef`, idsByCollection, errors);
  }
  for (const [index, relation] of array(model.architecture?.relations).entries()) {
    if (!componentIds.set.has(relation.from)) errors.push(error(`/architecture/relations/${index}/from`, `unknown component: ${relation.from}`));
    if (!componentIds.set.has(relation.to)) errors.push(error(`/architecture/relations/${index}/to`, `unknown component: ${relation.to}`));
  }
  for (const [index, boundary] of array(model.architecture?.boundaries).entries()) {
    for (const componentId of boundary.componentIds || []) if (!componentIds.set.has(componentId)) errors.push(error(`/architecture/boundaries/${index}/componentIds`, `unknown component: ${componentId}`));
  }
  if (model.commercial?.commercialLockHash !== model.commercialLockHash) errors.push(error("/commercial/commercialLockHash", "must match top-level commercialLockHash"));
  return errors;
}

function validateProvenanceRow(row = {}, path, errors) {
  const truthStatus = normalizeTruth(row.truthStatus);
  if (!truthStatus || truthStatus === "unknown") return;
  if (EXPLICIT_TRUTH.has(truthStatus) && !array(row.sourceIds).length) errors.push(error(`${path}/sourceIds`, `${truthStatus} data requires sourceIds`));
  if (DERIVED_TRUTH.has(truthStatus) && !array(row.sourceIds).length && !row.derivationRuleId) errors.push(error(`${path}/derivationRuleId`, `${truthStatus} data requires sourceIds or derivationRuleId`));
}

function capabilityFromScope(item, scopeItems = []) {
  const duplicateFeatureCount = scopeItems.filter((candidate) => clean(candidate.feature).toLocaleLowerCase() === clean(item.feature).toLocaleLowerCase()).length;
  const disambiguatedLabel = duplicateFeatureCount > 1 && item.detail
    ? `${item.feature}: ${item.detail}`
    : item.feature || item.label;
  return {
    id: item.capabilityIds[0],
    label: clean(disambiguatedLabel),
    type: capabilityType(item),
    truthStatus: item.truthStatus,
    sourceIds: item.sourceIds,
    derivationRuleId: item.derivationRuleId,
  };
}

function buildTemplateActors(proposalModel, scopeItems, locale = "en") {
  const text = `${proposalModel.title || ""} ${proposalModel.brief?.type || ""} ${scopeItems.map((item) => `${item.epic} ${item.feature}`).join(" ")}`;
  if (!/marketplace|marketpleys|маркетплейс|buyer|seller|заказ|vendor|merchant/i.test(text)) return [];
  const labels = marketplaceProcessCopy(locale).actors;
  return [
    envelope("ACTOR-BUYER", labels.buyer, "recommended", [], "MARKETPLACE-JOURNEY-V1", { type: "end_user" }),
    envelope("ACTOR-SELLER", labels.seller, "recommended", [], "MARKETPLACE-JOURNEY-V1", { type: "partner_actor" }),
    envelope("ACTOR-MARKETPLACE-SERVICE", labels.service, "recommended", [], "MARKETPLACE-JOURNEY-V1", { type: "system_actor" }),
    envelope("ACTOR-SUPPORT", labels.support, "recommended", [], "MARKETPLACE-JOURNEY-V1", { type: "internal_operator" }),
  ];
}

function buildRecommendedPrimaryProcess(proposalModel, actors = [], locale = "en") {
  const text = `${proposalModel.title || ""} ${proposalModel.brief?.type || ""}`;
  if (!actors.length || !/marketplace|marketpleys|маркетплейс/i.test(text)) {
    return { tasks: [], events: [], states: [], decisions: [], processes: [], processRelations: [], primaryProcessId: null };
  }
  const copy = marketplaceProcessCopy(locale);
  const derived = (id, label, extra) => envelope(id, label, "recommended", [], "MARKETPLACE-JOURNEY-V1", extra);
  const events = [
    derived("EVENT-MARKETPLACE-START", copy.events.start, { type: "start", actorId: "ACTOR-BUYER" }),
    derived("EVENT-MARKETPLACE-END", copy.events.end, { type: "end", actorId: "ACTOR-BUYER" }),
  ];
  const tasks = [
    derived("TASK-CATALOG-DISCOVERY", copy.tasks.catalog, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-CART-CHECKOUT", copy.tasks.checkout, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-PAYMENT-ORDER", copy.tasks.payment, { actorId: "ACTOR-MARKETPLACE-SERVICE", type: "service_task" }),
    derived("TASK-FULFILMENT-TRACKING", copy.tasks.fulfilment, { actorId: "ACTOR-SELLER", type: "manual_task" }),
    derived("TASK-RETURN-SUPPORT", copy.tasks.support, { actorId: "ACTOR-SUPPORT", type: "review" }),
  ];
  const states = [derived("STATE-ORDER-CONFIRMED", copy.states.confirmed, { type: "active", actorId: "ACTOR-MARKETPLACE-SERVICE" })];
  const decisions = [derived("DECISION-EXCEPTION", copy.decision.label, {
    actorId: "ACTOR-MARKETPLACE-SERVICE",
    question: copy.decision.question,
    branchLabels: [copy.decision.no, copy.decision.yes],
  })];
  const processRelations = [
    relation("REL-MP-01", "events/EVENT-MARKETPLACE-START", "tasks/TASK-CATALOG-DISCOVERY", "sequence", null),
    relation("REL-MP-02", "tasks/TASK-CATALOG-DISCOVERY", "tasks/TASK-CART-CHECKOUT", "sequence", null),
    relation("REL-MP-03", "tasks/TASK-CART-CHECKOUT", "tasks/TASK-PAYMENT-ORDER", "sequence", null),
    relation("REL-MP-04", "tasks/TASK-PAYMENT-ORDER", "states/STATE-ORDER-CONFIRMED", "success", copy.relations.confirmed),
    relation("REL-MP-05", "states/STATE-ORDER-CONFIRMED", "tasks/TASK-FULFILMENT-TRACKING", "sequence", null),
    relation("REL-MP-06", "tasks/TASK-FULFILMENT-TRACKING", "decisions/DECISION-EXCEPTION", "sequence", null),
    // Preserve the visible decision labels while assigning semantic path
    // roles explicitly. A generic Yes/No answer is not enough to determine
    // which branch is exceptional, so downstream code must not infer it from
    // the label alone.
    relation("REL-MP-07", "decisions/DECISION-EXCEPTION", "events/EVENT-MARKETPLACE-END", "success", copy.decision.no),
    relation("REL-MP-08", "decisions/DECISION-EXCEPTION", "tasks/TASK-RETURN-SUPPORT", "exception", copy.decision.yes),
    relation("REL-MP-09", "tasks/TASK-RETURN-SUPPORT", "events/EVENT-MARKETPLACE-END", "sequence", copy.relations.resolved),
  ];
  const process = derived("PROCESS-MARKETPLACE-JOURNEY", copy.process, {
    type: "primary",
    nodeRefs: [
      "events/EVENT-MARKETPLACE-START",
      "tasks/TASK-CATALOG-DISCOVERY",
      "tasks/TASK-CART-CHECKOUT",
      "tasks/TASK-PAYMENT-ORDER",
      "states/STATE-ORDER-CONFIRMED",
      "tasks/TASK-FULFILMENT-TRACKING",
      "decisions/DECISION-EXCEPTION",
      "tasks/TASK-RETURN-SUPPORT",
      "events/EVENT-MARKETPLACE-END",
    ],
    relationIds: processRelations.map((row) => row.id),
    actorIds: actors.map((row) => row.id),
  });
  return { tasks, events, states, decisions, processes: [process], processRelations, primaryProcessId: process.id };
}

function relation(id, fromRef, toRef, type, label) {
  return { id, fromRef, toRef, type, label };
}

function marketplaceProcessCopy(locale = "en") {
  if (locale === "uz-Latn") return {
    actors: { buyer: "Xaridor", seller: "Sotuvchi", service: "Marketpleys xizmati", support: "Yordam operatori" },
    events: { start: "Mahsulot qidiruvi boshlandi", end: "Buyurtma yakunlandi" },
    tasks: { catalog: "Katalog va qidiruv", checkout: "Savat va checkout", payment: "To‘lov va buyurtmani yaratish", fulfilment: "Bajarish va kuzatish", support: "Qaytarish yoki yordam holatini hal qilish" },
    states: { confirmed: "Buyurtma tasdiqlandi" },
    decision: { label: "Istisno holati", question: "Qaytarish yoki yordam kerakmi?", no: "Yo‘q", yes: "Ha" },
    relations: { confirmed: "buyurtma tasdiqlandi", resolved: "holat yopildi" },
    process: "Tavsiya etilgan marketpleys buyurtma jarayoni",
  };
  if (locale === "ru" || locale === "ru-RU") return {
    actors: { buyer: "Покупатель", seller: "Продавец", service: "Сервис маркетплейса", support: "Оператор поддержки" },
    events: { start: "Начат поиск товара", end: "Заказ завершён" },
    tasks: { catalog: "Каталог и поиск", checkout: "Корзина и checkout", payment: "Оплата и создание заказа", fulfilment: "Исполнение и отслеживание", support: "Обработка возврата или обращения" },
    states: { confirmed: "Заказ подтверждён" },
    decision: { label: "Исключение", question: "Нужен возврат или поддержка?", no: "Нет", yes: "Да" },
    relations: { confirmed: "заказ подтверждён", resolved: "обращение закрыто" },
    process: "Рекомендуемый путь заказа маркетплейса",
  };
  return {
    actors: { buyer: "Buyer", seller: "Seller", service: "Marketplace service", support: "Support operator" },
    events: { start: "Product discovery started", end: "Order completed" },
    tasks: { catalog: "Catalog and search", checkout: "Cart and checkout", payment: "Payment and order creation", fulfilment: "Fulfilment and tracking", support: "Resolve return or support case" },
    states: { confirmed: "Order confirmed" },
    decision: { label: "Exception decision", question: "Is a return or support case required?", no: "No", yes: "Yes" },
    relations: { confirmed: "order confirmed", resolved: "case resolved" },
    process: "Recommended marketplace order journey",
  };
}

function buildIntegrations(scopeItems) {
  return scopeItems
    .filter((item) => item.ownership === "partner_integrated")
    .map((item, index) => envelope(`INT-${String(index + 1).padStart(3, "0")}`, item.feature || item.label, item.truthStatus, item.sourceIds, item.derivationRuleId, {
      type: integrationType(item),
      providerName: null,
    }));
}

function buildDataStores(scopeItems, locale = "en") {
  if (!scopeItems.length) return [];
  const ru = locale === "ru" || locale === "ru-RU";
  const uz = locale === "uz-Latn";
  const label = uz
    ? "PostgreSQL asosiy ma’lumotlar bazasi"
    : ru
      ? "Основная база данных PostgreSQL"
      : "PostgreSQL primary database";
  const stores = [envelope("DATA-PRIMARY-RELATIONAL", label, "recommended", [], "ARCH-POSTGRESQL-RECOMMENDATION-V1", { kind: "relational_database" })];
  const scopeText = scopeItems.map((item) => `${item.epic} ${item.feature} ${item.detail}`).join(" ");
  if (/catalog|katalog|каталог|media|photo|фото|товар|mahsulot|product card/iu.test(scopeText)) {
    stores.push(envelope(
      "DATA-OBJECT-STORAGE",
      uz ? "Fayl saqlash / CDN (media)" : ru ? "Файловое хранилище / CDN (медиа)" : "Object storage / CDN (media)",
      "recommended",
      [],
      "ARCH-OBJECT-STORAGE-RECOMMENDATION-V1",
      { kind: "object_storage" },
    ));
  }
  if (/analytics|analitika|аналитик|отчет|отчёт|hisobot|report|export/iu.test(scopeText)) {
    stores.push(envelope(
      "DATA-ANALYTICS-CLICKHOUSE",
      uz ? "ClickHouse analitik ombori" : ru ? "Аналитическое хранилище ClickHouse" : "ClickHouse analytics store",
      "recommended",
      [],
      "ARCH-CLICKHOUSE-RECOMMENDATION-V1",
      { kind: "analytics_store" },
    ));
  }
  return stores;
}

function buildArchitecture({ capabilities, integrations, dataStores, scopeItems, projectName, locale = "en", actors = [] }) {
  const ru = locale === "ru" || locale === "ru-RU";
  const uz = locale === "uz-Latn";
  const contextText = `${projectName} ${scopeItems.map((item) => `${item.epic} ${item.feature} ${item.detail}`).join(" ")}`;
  const isMarketplace = actors.some((actor) => actor?.id === "ACTOR-SELLER")
    || /marketplace|marketpleys|маркетплейс|seller|vendor|sotuvchi|продавц/iu.test(contextText);
  // The infrastructure view names concrete recommended surfaces per platform
  // role instead of reusing scope-row labels, so every layer reads like a
  // deployable component (channel -> API -> core -> data -> integrations).
  const channelDefinitions = isMarketplace
    ? [
        ["COMP-CHANNEL-BUYER-WEB", uz ? "Xaridor veb-ilovasi · React" : ru ? "Веб-приложение покупателя · React" : "Buyer web application · React"],
        ["COMP-CHANNEL-SELLER-CABINET", uz ? "Sotuvchi kabineti · React" : ru ? "Кабинет продавца · React" : "Seller cabinet · React"],
        ["COMP-CHANNEL-ADMIN-PANEL", uz ? "Admin-panel · React" : ru ? "Админ-панель · React" : "Admin panel · React"],
      ]
    : scopeItems.length
      ? [
          ["COMP-CHANNEL-WEB-APP", uz ? "Veb-ilova · React" : ru ? "Веб-приложение · React" : "Web application · React"],
          ["COMP-CHANNEL-ADMIN-PANEL", uz ? "Admin-panel · React" : ru ? "Админ-панель · React" : "Admin panel · React"],
        ]
      : [];
  const channels = channelDefinitions.map(([id, label]) => envelope(id, label, "recommended", [], "ARCH-CHANNEL-RECOMMENDATION-V1", { kind: "channel", entityRef: null, semanticRole: "owned" }));
  const recommendedExternal = integrations.length
    ? []
    : isMarketplace
      ? [
          envelope("COMP-EXTERNAL-PAYMENTS", uz ? "To‘lov provayderi" : ru ? "Платёжный провайдер" : "Payment provider", "recommended", [], "ARCH-EXTERNAL-BOUNDARY-V1", { kind: "external", entityRef: null, semanticRole: "partner" }),
          envelope("COMP-EXTERNAL-SMS", uz ? "SMS-shlyuz / bildirishnomalar" : ru ? "SMS-шлюз / уведомления" : "SMS gateway / notifications", "recommended", [], "ARCH-EXTERNAL-BOUNDARY-V1", { kind: "external", entityRef: null, semanticRole: "partner" }),
          envelope("COMP-EXTERNAL-SMTP", "Email · SMTP", "recommended", [], "ARCH-EXTERNAL-BOUNDARY-V1", { kind: "external", entityRef: null, semanticRole: "partner" }),
        ]
      : [envelope("COMP-EXTERNAL-TO-CONFIRM", uz ? "Tasdiqlanadigan tashqi servislar" : ru ? "Внешние сервисы к согласованию" : "External services to confirm", "recommended", [], "ARCH-EXTERNAL-BOUNDARY-V1", { kind: "external", entityRef: null, semanticRole: "partner" })];
  const backendApiLabel = "Backend API · REST";
  // U+2011 non-breaking hyphen: the word-break hardcheck must never see the
  // tech caption split across lines inside a narrow architecture node.
  const coreLabel = uz
    ? `${clean(projectName) || "Mahsulot"} yadrosi · Golang mikroservislar`
    : ru
      ? `Ядро «${clean(projectName) || "Продукт"}» · Golang‑микросервисы`
      : `${clean(projectName) || "Product"} core · Golang microservices`;
  const components = [
    ...channels,
    envelope("COMP-APP-CORE", coreLabel, "recommended", [], "ARCH-CORE-V1", { kind: "application", entityRef: capabilities[0] ? `capabilities/${capabilities[0].id}` : null, semanticRole: "owned" }),
    envelope("COMP-BACKEND-API", backendApiLabel, "recommended", [], "ARCH-BACKEND-API-RECOMMENDATION-V1", { kind: "service", entityRef: null, semanticRole: "owned" }),
    ...dataStores.map((item) => envelope(`COMP-${item.id}`, item.label, item.truthStatus, item.sourceIds, item.derivationRuleId, { kind: "data_store", entityRef: `dataStores/${item.id}`, semanticRole: "owned" })),
    ...integrations.map((item) => envelope(`COMP-${item.id}`, item.label, item.truthStatus, item.sourceIds, item.derivationRuleId, { kind: "external", entityRef: `integrations/${item.id}`, semanticRole: "partner" })),
    ...recommendedExternal,
  ];
  const relations = [
    ...channels.map((item) => ({ id: `AR-${item.id}-API`, from: item.id, to: "COMP-BACKEND-API", type: "request", direction: "forward" })),
    { id: "AR-API-CORE", from: "COMP-BACKEND-API", to: "COMP-APP-CORE", type: "request", direction: "forward" },
    ...dataStores.map((item) => ({ id: `AR-CORE-${item.id}`, from: "COMP-APP-CORE", to: `COMP-${item.id}`, type: "reads_writes", direction: "both" })),
    ...integrations.map((item) => ({ id: `AR-CORE-${item.id}`, from: "COMP-APP-CORE", to: `COMP-${item.id}`, type: "request", direction: "forward" })),
    ...recommendedExternal.map((item) => ({ id: `AR-CORE-${item.id}`, from: "COMP-APP-CORE", to: item.id, type: "request", direction: "forward" })),
  ];
  return {
    components,
    relations,
    boundaries: [
      envelope("BOUNDARY-PRODUCT", "Trusted product", "recommended", [], "ARCH-BOUNDARY-V1", { componentIds: components.filter((item) => item.semanticRole === "owned").map((item) => item.id), type: "trusted_product" }),
      ...((integrations.length || recommendedExternal.length) ? [envelope("BOUNDARY-PARTNER", "External partners", "recommended", [], "ARCH-BOUNDARY-V1", { componentIds: [...integrations.map((item) => `COMP-${item.id}`), ...recommendedExternal.map((item) => item.id)], type: "external_partner" })] : []),
    ],
  };
}

function buildMarket(proposalModel) {
  const source = proposalModel.market || proposalModel.tamSamSom || {};
  const geography = nullableText(source.geography);
  const period = nullableText(source.period);
  const rawCurrency = nullableText(source.currency);
  const currency = rawCurrency === "XXX" ? null : rawCurrency;
  const tam = normalizeMarketMetric(source.tam, { geography, period, currency });
  const sam = normalizeMarketMetric(source.sam, { geography, period, currency });
  const somScenarios = array(source.somScenarios || source.som).map((item, index) => normalizeMarketScenario(item, index, { geography, period, currency })).filter(Boolean);
  const requestedStatus = ["unknown", "verified", "modeled", "conflicted"].includes(source.status) ? source.status : null;
  return {
    status: requestedStatus || (tam && sam ? "modeled" : "unknown"),
    geography,
    period,
    currency,
    tam,
    sam,
    somScenarios,
    methodology: array(source.methodology || source.formulas || [source.formula, ...array(source.assumptions)]).map(clean).filter(Boolean),
    sourceIds: unique([...array(source.sourceIds).map(String), ...array(source.sources).map((row) => row?.id).filter(Boolean).map(String)]),
  };
}

function normalizeFunctionPriceItems(functionPrice = []) {
  return array(functionPrice).map((item, index) => {
    const truthStatus = normalizeTruth(item?.truthStatus) || "unknown";
    return {
      id: item.id || `PRICE-${String(index + 1).padStart(3, "0")}`,
      label: clean(item.name || item.label || item.feature || `Function ${index + 1}`),
      amount: moneyNumber(item.amount ?? item.total ?? 0),
      truthStatus,
      sourceIds: sourceIdsFor(item, truthStatus),
      derivationRuleId: derivationRuleFor(item, truthStatus),
    };
  });
}

function normalizeRoadmapDependencies(dependencies, phases) {
  const phaseIds = new Set(phases.map((phase) => phase.id));
  return array(dependencies).filter((dep) => phaseIds.has(dep.fromPhaseId) && phaseIds.has(dep.toPhaseId)).map((dep) => ({
    fromPhaseId: dep.fromPhaseId,
    toPhaseId: dep.toPhaseId,
    type: dep.type || "finish_to_start",
    lag: Number(dep.lag || 0),
    allowOverlap: Boolean(dep.allowOverlap),
  }));
}

function inferRoadmapEndMonth(roadmap = []) {
  return Math.max(0, ...array(roadmap).map((item) => {
    const row = Array.isArray(item) ? { months: item[2] } : item || {};
    return Number(row.endMonth ?? row.month ?? row.months ?? 0);
  }).filter((value) => Number.isFinite(value)));
}

function normalizeAnalogs(analogs, sources = []) {
  return array(analogs).map((item, index) => {
    const row = typeof item === "string" ? { label: item, learning: item } : item || {};
    const rawLearning = clean(row.learning || row.insight || row.summary || row.label || "");
    const blocked = isBlockedResearchText(rawLearning);
    const matchingSourceId = sources.find((source) => row.url && source.source === row.url)?.id;
    const explicitSourceIds = unique([...array(row.sourceIds).map(String), ...(matchingSourceId ? [matchingSourceId] : [])]);
    const truthStatus = blocked ? "unknown" : normalizeTruth(row.truthStatus) || (explicitSourceIds.length ? "single_source" : "recommended");
    const learning = blocked
      ? "The analogue source could not be validated; confirm the relevant journey and operating model before copying any pattern."
      : rawLearning || "Use the analogue only as a validation lens; do not copy unverified features into scope.";
    return envelope(row.id || `ANALOG-${String(index + 1).padStart(3, "0")}`, row.label || row.name || row.title || `Analog ${index + 1}`, truthStatus, explicitSourceIds, truthStatus === "recommended" ? "ANALOG-VALIDATION-LENS-V1" : derivationRuleFor(row, truthStatus), {
      url: row.url || null,
      learning,
      scopeEffect: blocked ? "validate" : row.scopeEffect || "benchmark_only",
    });
  });
}

function normalizeRisks(risks) {
  return array(risks).map((item, index) => {
    const row = typeof item === "string" ? { label: item } : item || {};
    const truthStatus = normalizeTruth(row.truthStatus) || "recommended";
    return envelope(row.id || `RISK-${String(index + 1).padStart(3, "0")}`, row.label || row.name || `Risk ${index + 1}`, truthStatus, sourceIdsFor(row, truthStatus), derivationRuleFor(row, truthStatus) || "RISK-NORMALIZER-V1", {
      severity: row.severity || "medium",
      mitigation: row.mitigation || null,
    });
  });
}

function swotRow(value, quadrant, index) {
  const row = typeof value === "string" ? { label: value } : value || {};
  const normalizedQuadrant = normalizeSwotQuadrant(quadrant);
  const truthStatus = normalizeTruth(row.truthStatus) || "recommended";
  return envelope(row.id || `SWOT-${normalizedQuadrant.toUpperCase()}-${index + 1}`, row.label || row.text || `${normalizedQuadrant} item`, truthStatus, sourceIdsFor(row, truthStatus), derivationRuleFor(row, truthStatus), {
    quadrant: normalizedQuadrant,
    response: row.response || null,
  });
}

function normalizeSwotQuadrant(value) {
  const normalized = clean(value).toLocaleLowerCase();
  if (/^strengths?$/.test(normalized)) return "strength";
  if (/^weakness(?:es)?$/.test(normalized)) return "weakness";
  if (/^opportunit(?:y|ies)$/.test(normalized)) return "opportunity";
  if (/^threats?$/.test(normalized)) return "threat";
  return "strength";
}

function normalizeMarketMetric(value, defaults) {
  if (!value || typeof value !== "object") return null;
  const amount = moneyNumber(value.value ?? value.amount);
  const currency = nullableText(value.currency || defaults.currency);
  const period = nullableText(value.period || defaults.period);
  const geography = nullableText(value.geography || defaults.geography);
  if (!(amount > 0) || !currency || !period || !geography) return null;
  const truthStatus = normalizeTruth(value.truthStatus) || "unknown";
  const rawShareOfParent = Number(value.shareOfParent ?? value.share);
  const shareOfParent = Number.isFinite(rawShareOfParent) && rawShareOfParent > 0 && rawShareOfParent <= 1
    ? rawShareOfParent
    : null;
  return {
    value: amount,
    currency,
    period,
    geography,
    shareOfParent,
    truthStatus,
    claimNature: nullableText(value.claimNature),
    evidenceExcerpt: nullableText(value.evidenceExcerpt),
    sourceIds: sourceIdsFor(value, truthStatus),
    derivationRuleId: derivationRuleFor(value, truthStatus),
  };
}

function normalizeMarketScenario(value, index, defaults) {
  if (!value || typeof value !== "object") return null;
  const amount = moneyNumber(value.value ?? value.amount);
  const shareOfParent = Number(value.shareOfParent ?? value.share ?? value.captureRate);
  const currency = nullableText(value.currency || defaults.currency);
  const period = nullableText(value.period || defaults.period);
  const geography = nullableText(value.geography || defaults.geography);
  if (!(amount > 0) || !(shareOfParent > 0 && shareOfParent <= 1) || !currency || !period || !geography) return null;
  const truthStatus = normalizeTruth(value.truthStatus) || "assumed";
  return envelope(value.id || `MARKET-SOM-${index + 1}`, value.label || value.scenarioLabel || `Scenario ${index + 1}`, truthStatus, sourceIdsFor(value, truthStatus), derivationRuleFor(value, truthStatus) || "SOM-SCENARIO-V1", {
    value: amount,
    currency,
    period,
    geography,
    shareOfParent,
    claimNature: nullableText(value.claimNature),
  });
}

function isBlockedResearchText(value) {
  return /(?:just a moment|access denied|captcha|verify you are human|enable javascript|robot emas|автоматическ(?:ий|ие) запрос|подтвердите, что вы не робот)/i.test(String(value || ""));
}

function nullableText(value) {
  const text = clean(value);
  return text || null;
}

function envelope(id, label, truthStatus, sourceIds = [], derivationRuleId = null, extra = {}) {
  return { id, label: clean(label || id), truthStatus, sourceIds: array(sourceIds).map(String), derivationRuleId, ...extra };
}

function forEachEnvelope(model, fn) {
  for (const collection of ["actors", "capabilities", "tasks", "scopeItems", "events", "states", "decisions", "integrations", "dataStores", "processes", "architecture.components", "architecture.boundaries", "roadmap.phases", "analogs", "swot", "risks"]) {
    const rows = collection.split(".").reduce((cursor, key) => cursor?.[key], model) || [];
    rows.forEach((row, index) => fn(row, `/${collection.replace(".", "/")}/${index}`));
  }
}

function validateProcessRef(ref, path, idsByCollection, errors) {
  const parsed = parseRef(ref);
  if (!parsed || !PROCESS_REF_COLLECTIONS.includes(parsed.collection)) {
    errors.push(error(path, `invalid process ref: ${ref}`));
    return;
  }
  if (!idsByCollection[parsed.collection]?.set.has(parsed.id)) errors.push(error(path, `unknown process node: ${ref}`));
}

function validateEntityRef(ref, path, idsByCollection, errors) {
  const parsed = parseRef(ref);
  if (!parsed || !ENTITY_REF_COLLECTIONS.includes(parsed.collection)) {
    errors.push(error(path, `invalid entity ref: ${ref}`));
    return;
  }
  if (!idsByCollection[parsed.collection]?.set.has(parsed.id)) errors.push(error(path, `unknown semantic entity: ${ref}`));
}

function parseRef(ref) {
  const [collection, ...rest] = String(ref || "").split("/");
  const id = rest.join("/");
  return collection && id ? { collection, id } : null;
}

function idSet(rows = []) {
  const set = new Set();
  const duplicates = [];
  for (const row of rows || []) {
    if (set.has(row.id)) duplicates.push(row.id);
    set.add(row.id);
  }
  return { set, duplicates };
}

function sourceIdsFor(row, truthStatus) {
  const ids = array(row.sourceIds).map(String);
  if (ids.length) return ids;
  return EXPLICIT_TRUTH.has(truthStatus) ? ["SRC-PROMPT"] : [];
}

function derivationRuleFor(row, truthStatus) {
  if (row.derivationRuleId !== undefined) return row.derivationRuleId;
  return DERIVED_TRUTH.has(truthStatus) ? "SEMANTIC-NORMALIZER-V1" : null;
}

function inclusionFromText(text = "") {
  if (/(out of scope|вне|emas|not included)/i.test(text)) return "out_of_scope";
  if (/(defer|future|later|optional|потом|кейин)/i.test(text)) return "deferred";
  if (/(recommend|suggest|можно|tavsiya)/i.test(text)) return "recommended";
  return "requested";
}

function ownershipFromText(text = "") {
  if (/(out of scope|вне|not included)/i.test(text)) return "out_of_scope";
  if (/(defer|future|later|optional|потом|кейин)/i.test(text)) return "deferred";
  if (/(partner|external|integration|vendor|third-party|3rd party|provider)/i.test(text)) return "partner_integrated";
  return "owned";
}

function truthFromText(text = "") {
  if (/(recommend|suggest|template|default|можно|tavsiya)/i.test(text)) return "recommended";
  if (/(assume|assumed|предполож)/i.test(text)) return "assumed";
  return "explicit";
}

function capabilityType(item) {
  const text = `${item.epic} ${item.feature} ${item.detail}`;
  if (/admin|cabinet|mobile|web|app|portal|ui|ux/i.test(text)) return "product_surface";
  if (/report|analytics|dashboard/i.test(text)) return "reporting";
  if (/support|help/i.test(text)) return "support";
  if (/control|moderation|approval/i.test(text)) return "control";
  return "domain_capability";
}

function integrationType(item) {
  const text = `${item.epic} ${item.feature} ${item.detail}`;
  if (/pay|wallet|card|invoice/i.test(text)) return "payment";
  if (/fiscal|tax|ofd/i.test(text)) return "fiscal";
  if (/deliver|courier|shipping/i.test(text)) return "delivery";
  if (/sms|telegram|email|push|message/i.test(text)) return "messaging";
  if (/auth|identity|sso|login/i.test(text)) return "identity";
  if (/analytics|bi|metric/i.test(text)) return "analytics";
  return "other";
}

function phaseIdFromText(value) {
  const match = String(value || "").match(/(?:phase|month|m)\s*([0-9]+)/i);
  return match ? `PHASE-${Number(match[1])}` : null;
}

function normalizeTruth(value) {
  return ["explicit", "verified", "single_source", "recommended", "inferred", "assumed", "unknown"].includes(value) ? value : null;
}

function normalizeInclusion(value) {
  return ["requested", "in_scope", "recommended", "deferred", "out_of_scope", "unknown"].includes(value) ? value : null;
}

function normalizeOwnership(value) {
  return ["owned", "partner_integrated", "deferred", "out_of_scope", "unknown"].includes(value) ? value : null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function moneyNumber(value) {
  const number = Number(String(value ?? 0).replace(/[$,\s]/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function array(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function unique(values) {
  return [...new Set(values)];
}

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function error(path, message) {
  return { path, keyword: "semantic", message, params: {} };
}
