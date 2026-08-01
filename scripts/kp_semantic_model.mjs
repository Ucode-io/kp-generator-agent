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
      // Keep the client-facing delivery window on the semantic scope item.
      // Product-map leaves inherit this value when the function schedule and
      // development roadmap are expanded from the same canonical inventory.
      phase: clean(row.phase || row.deadline || ""),
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
  const processIds = idSet(model.processes);
  for (const [index, relation] of array(model.processRelations).entries()) {
    validateProcessRef(relation.fromRef, `/processRelations/${index}/fromRef`, idsByCollection, errors);
    validateProcessRef(relation.toRef, `/processRelations/${index}/toRef`, idsByCollection, errors);
  }
  for (const [index, process] of array(model.processes).entries()) {
    for (const nodeRef of process.nodeRefs || []) validateProcessRef(nodeRef, `/processes/${index}/nodeRefs`, idsByCollection, errors);
    for (const relationId of process.relationIds || []) if (!relationIds.set.has(relationId)) errors.push(error(`/processes/${index}/relationIds`, `unknown process relation: ${relationId}`));
    for (const actorId of process.actorIds || []) if (!idsByCollection.actors.set.has(actorId)) errors.push(error(`/processes/${index}/actorIds`, `unknown actor: ${actorId}`));
    if (process.continuationOf && (!processIds.set.has(process.continuationOf) || process.continuationOf === process.id)) {
      errors.push(error(`/processes/${index}/continuationOf`, `must reference another process: ${process.continuationOf}`));
    }
    if (process.sequence !== undefined && (!Number.isInteger(process.sequence) || process.sequence < 1)) {
      errors.push(error(`/processes/${index}/sequence`, "must be a positive integer"));
    }
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
  const text = `${proposalModel.title || ""} ${proposalModel.brief?.type || ""} ${proposalModel.brief?.prompt || ""} ${scopeItems.map((item) => `${item.epic} ${item.feature} ${item.detail}`).join(" ")}`;
  const explicitCommerceIntent = /marketplace|marketpleys|маркетплейс|internet\s*magazin|online\s*store|e-?commerce|интернет[- ]?магазин|онлайн[- ]?магазин|elektron\s*tijorat/i.test(text);
  const commerceSignals = [
    /buyer|покупател|xaridor/i,
    /seller|продавц|sotuvchi|vendor|merchant/i,
    /catalog|каталог|katalog|product card|карточк[аи]\s+товар|mahsulot/i,
    /cart|корзин|savat|checkout|оформлени[ея]\s+заказ/i,
  ].filter((pattern) => pattern.test(text)).length;
  if (!explicitCommerceIntent && commerceSignals < 2) return [];
  const labels = marketplaceProcessCopy(locale).actors;
  return [
    envelope("ACTOR-BUYER", labels.buyer, "recommended", [], "MARKETPLACE-JOURNEY-V1", { type: "end_user" }),
    envelope("ACTOR-SELLER", labels.seller, "recommended", [], "MARKETPLACE-JOURNEY-V1", { type: "partner_actor" }),
    envelope("ACTOR-MARKETPLACE-SERVICE", labels.service, "recommended", [], "MARKETPLACE-JOURNEY-V1", { type: "system_actor" }),
    envelope("ACTOR-SUPPORT", labels.support, "recommended", [], "MARKETPLACE-JOURNEY-V1", { type: "internal_operator" }),
  ];
}

function buildRecommendedPrimaryProcess(proposalModel, actors = [], locale = "en") {
  // Template actors are created only after marketplace/e-commerce intent is
  // detected across the title, brief, or normalized scope. Reuse that
  // decision here so a generic synthesized brief title cannot erase a clear
  // marketplace signal that was present in the client's scope.
  if (!actors.length) {
    return { tasks: [], events: [], states: [], decisions: [], processes: [], processRelations: [], primaryProcessId: null };
  }
  const copy = marketplaceProcessCopy(locale);
  const derived = (id, label, extra) => envelope(id, label, "recommended", [], "MARKETPLACE-JOURNEY-V1", extra);
  const events = [
    derived("EVENT-MARKETPLACE-START", copy.events.discoveryStarted, { type: "start", actorId: "ACTOR-BUYER" }),
    derived("EVENT-CHECKOUT-READY", copy.events.checkoutReady, { type: "end", actorId: "ACTOR-MARKETPLACE-SERVICE" }),
    derived("EVENT-ORDER-HANDOFF", copy.events.orderHandoff, { type: "end", actorId: "ACTOR-SELLER" }),
    derived("EVENT-CHECKOUT-STOPPED", copy.events.checkoutStopped, { type: "end", actorId: "ACTOR-BUYER" }),
    derived("EVENT-PAYMENT-START", copy.events.paymentStarted, { type: "start", actorId: "ACTOR-BUYER" }),
    derived("EVENT-PAYMENT-STOPPED", copy.events.paymentStopped, { type: "end", actorId: "ACTOR-BUYER" }),
    derived("EVENT-FULFILMENT-START", copy.events.fulfilmentStarted, { type: "start", actorId: "ACTOR-SELLER" }),
    derived("EVENT-FULFILMENT-COMPLETED", copy.events.fulfilmentCompleted, { type: "end", actorId: "ACTOR-BUYER" }),
    derived("EVENT-DELIVERY-ISSUE-HANDOFF", copy.events.deliveryIssueHandoff, { type: "end", actorId: "ACTOR-SUPPORT" }),
    derived("EVENT-SUPPORT-CHECK-START", copy.events.supportCheckStarted, { type: "start", actorId: "ACTOR-MARKETPLACE-SERVICE" }),
    derived("EVENT-MARKETPLACE-END", copy.events.orderCompleted, { type: "end", actorId: "ACTOR-BUYER" }),
  ];
  const tasks = [
    derived("TASK-CATALOG-DISCOVERY", copy.tasks.catalog, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-PRODUCT-SELECTION", copy.tasks.product, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-CART-CHECKOUT", copy.tasks.cart, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-DELIVERY-DETAILS", copy.tasks.delivery, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-CART-VALIDATION", copy.tasks.validation, { actorId: "ACTOR-MARKETPLACE-SERVICE", type: "service_task" }),
    derived("TASK-CART-CORRECTION", copy.tasks.correction, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-PAYMENT-ORDER", copy.tasks.payment, { actorId: "ACTOR-MARKETPLACE-SERVICE", type: "service_task" }),
    derived("TASK-PAYMENT-CORRECTION", copy.tasks.paymentCorrection, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-ROUTE-ORDER", copy.tasks.routeOrder, { actorId: "ACTOR-MARKETPLACE-SERVICE", type: "service_task" }),
    derived("TASK-SELLER-ACCEPT", copy.tasks.sellerAccept, { actorId: "ACTOR-SELLER", type: "manual_task" }),
    derived("TASK-PICK-PACK", copy.tasks.pickPack, { actorId: "ACTOR-SELLER", type: "manual_task" }),
    derived("TASK-DELIVERY-HANDOFF", copy.tasks.deliveryHandoff, { actorId: "ACTOR-SELLER", type: "manual_task" }),
    derived("TASK-TRACKING-UPDATE", copy.tasks.tracking, { actorId: "ACTOR-MARKETPLACE-SERVICE", type: "service_task" }),
    derived("TASK-CONFIRM-RECEIPT", copy.tasks.receipt, { actorId: "ACTOR-BUYER", type: "user_task" }),
    derived("TASK-SUPPORT-INTAKE", copy.tasks.supportIntake, { actorId: "ACTOR-SUPPORT", type: "review" }),
    derived("TASK-SUPPORT-REVIEW", copy.tasks.supportReview, { actorId: "ACTOR-SUPPORT", type: "review" }),
    derived("TASK-RETURN-REFUND", copy.tasks.returnRefund, { actorId: "ACTOR-SUPPORT", type: "manual_task" }),
    derived("TASK-CLOSE-CASE", copy.tasks.closeCase, { actorId: "ACTOR-SUPPORT", type: "manual_task" }),
  ];
  const states = [
    derived("STATE-ORDER-CONFIRMED", copy.states.confirmed, { type: "active", actorId: "ACTOR-MARKETPLACE-SERVICE" }),
    derived("STATE-DELIVERY-COMPLETED", copy.states.delivered, { type: "active", actorId: "ACTOR-BUYER" }),
  ];
  const decisions = [
    derived("DECISION-STOCK-AVAILABLE", copy.decisions.stock.label, {
      actorId: "ACTOR-MARKETPLACE-SERVICE",
      question: copy.decisions.stock.question,
      branchLabels: [copy.decisions.stock.yes, copy.decisions.stock.no],
    }),
    derived("DECISION-PAYMENT-SUCCESS", copy.decisions.payment.label, {
      actorId: "ACTOR-MARKETPLACE-SERVICE",
      question: copy.decisions.payment.question,
      branchLabels: [copy.decisions.payment.yes, copy.decisions.payment.no],
    }),
    derived("DECISION-SUPPORT-REQUIRED", copy.decisions.support.label, {
      actorId: "ACTOR-MARKETPLACE-SERVICE",
      question: copy.decisions.support.question,
      branchLabels: [copy.decisions.support.no, copy.decisions.support.yes],
    }),
    derived("DECISION-CASE-APPROVED", copy.decisions.approval.label, {
      actorId: "ACTOR-SUPPORT",
      question: copy.decisions.approval.question,
      branchLabels: [copy.decisions.approval.yes, copy.decisions.approval.no],
    }),
  ];
  const checkoutRelations = [
    relation("REL-MP-01", "events/EVENT-MARKETPLACE-START", "tasks/TASK-CATALOG-DISCOVERY", "sequence", null),
    relation("REL-MP-02", "tasks/TASK-CATALOG-DISCOVERY", "tasks/TASK-PRODUCT-SELECTION", "sequence", null),
    relation("REL-MP-03", "tasks/TASK-PRODUCT-SELECTION", "tasks/TASK-CART-CHECKOUT", "sequence", null),
    relation("REL-MP-04", "tasks/TASK-CART-CHECKOUT", "tasks/TASK-DELIVERY-DETAILS", "sequence", null),
    relation("REL-MP-05", "tasks/TASK-DELIVERY-DETAILS", "tasks/TASK-CART-VALIDATION", "sequence", null),
    relation("REL-MP-06", "tasks/TASK-CART-VALIDATION", "decisions/DECISION-STOCK-AVAILABLE", "sequence", null),
    relation("REL-MP-07", "decisions/DECISION-STOCK-AVAILABLE", "events/EVENT-CHECKOUT-READY", "yes", copy.decisions.stock.yes),
    relation("REL-MP-08", "decisions/DECISION-STOCK-AVAILABLE", "tasks/TASK-CART-CORRECTION", "no", copy.decisions.stock.no),
    relation("REL-MP-09", "tasks/TASK-CART-CORRECTION", "events/EVENT-CHECKOUT-STOPPED", "sequence", copy.relations.cartUpdateRequired),
  ];
  const paymentRelations = [
    relation("REL-MP-10", "events/EVENT-PAYMENT-START", "tasks/TASK-PAYMENT-ORDER", "sequence", null),
    relation("REL-MP-11", "tasks/TASK-PAYMENT-ORDER", "decisions/DECISION-PAYMENT-SUCCESS", "sequence", null),
    relation("REL-MP-12", "decisions/DECISION-PAYMENT-SUCCESS", "states/STATE-ORDER-CONFIRMED", "success", copy.decisions.payment.yes),
    relation("REL-MP-13", "decisions/DECISION-PAYMENT-SUCCESS", "tasks/TASK-PAYMENT-CORRECTION", "no", copy.decisions.payment.no),
    relation("REL-MP-14", "tasks/TASK-PAYMENT-CORRECTION", "events/EVENT-PAYMENT-STOPPED", "sequence", copy.relations.paymentNotCompleted),
    relation("REL-MP-15", "states/STATE-ORDER-CONFIRMED", "tasks/TASK-ROUTE-ORDER", "sequence", copy.relations.confirmed),
    relation("REL-MP-16", "tasks/TASK-ROUTE-ORDER", "events/EVENT-ORDER-HANDOFF", "message", copy.relations.orderTransferred),
  ];
  const fulfilmentRelations = [
    relation("REL-MP-17", "events/EVENT-FULFILMENT-START", "tasks/TASK-SELLER-ACCEPT", "sequence", null),
    relation("REL-MP-18", "tasks/TASK-SELLER-ACCEPT", "tasks/TASK-PICK-PACK", "sequence", null),
    relation("REL-MP-19", "tasks/TASK-PICK-PACK", "tasks/TASK-DELIVERY-HANDOFF", "sequence", null),
    relation("REL-MP-20", "tasks/TASK-DELIVERY-HANDOFF", "tasks/TASK-TRACKING-UPDATE", "message", copy.relations.shipmentRegistered),
    relation("REL-MP-21", "tasks/TASK-TRACKING-UPDATE", "tasks/TASK-CONFIRM-RECEIPT", "sequence", null),
    relation("REL-MP-22", "tasks/TASK-TRACKING-UPDATE", "events/EVENT-DELIVERY-ISSUE-HANDOFF", "exception", copy.relations.deliveryIssue),
    relation("REL-MP-23", "tasks/TASK-CONFIRM-RECEIPT", "states/STATE-DELIVERY-COMPLETED", "success", copy.relations.delivered),
    relation("REL-MP-24", "states/STATE-DELIVERY-COMPLETED", "events/EVENT-FULFILMENT-COMPLETED", "sequence", copy.relations.delivered),
  ];
  const supportRelations = [
    relation("REL-MP-25", "events/EVENT-SUPPORT-CHECK-START", "decisions/DECISION-SUPPORT-REQUIRED", "sequence", null),
    relation("REL-MP-26", "decisions/DECISION-SUPPORT-REQUIRED", "events/EVENT-MARKETPLACE-END", "success", copy.decisions.support.no),
    relation("REL-MP-27", "decisions/DECISION-SUPPORT-REQUIRED", "tasks/TASK-SUPPORT-INTAKE", "exception", copy.decisions.support.yes),
    relation("REL-MP-28", "tasks/TASK-SUPPORT-INTAKE", "tasks/TASK-SUPPORT-REVIEW", "sequence", null),
    relation("REL-MP-29", "tasks/TASK-SUPPORT-REVIEW", "decisions/DECISION-CASE-APPROVED", "sequence", null),
    relation("REL-MP-30", "decisions/DECISION-CASE-APPROVED", "tasks/TASK-RETURN-REFUND", "yes", copy.decisions.approval.yes),
    relation("REL-MP-31", "decisions/DECISION-CASE-APPROVED", "tasks/TASK-CLOSE-CASE", "no", copy.decisions.approval.no),
    relation("REL-MP-32", "tasks/TASK-RETURN-REFUND", "tasks/TASK-CLOSE-CASE", "sequence", null),
    relation("REL-MP-33", "tasks/TASK-CLOSE-CASE", "events/EVENT-MARKETPLACE-END", "sequence", copy.relations.resolved),
  ];
  const journeyId = "JOURNEY-MARKETPLACE-ORDER";
  const checkoutProcess = derived("PROCESS-MARKETPLACE-CHECKOUT", copy.processes.checkout, {
    type: "primary",
    journeyId,
    sequence: 1,
    nodeRefs: [
      "events/EVENT-MARKETPLACE-START",
      "tasks/TASK-CATALOG-DISCOVERY",
      "tasks/TASK-PRODUCT-SELECTION",
      "tasks/TASK-CART-CHECKOUT",
      "tasks/TASK-DELIVERY-DETAILS",
      "tasks/TASK-CART-VALIDATION",
      "decisions/DECISION-STOCK-AVAILABLE",
      "tasks/TASK-CART-CORRECTION",
      "events/EVENT-CHECKOUT-READY",
      "events/EVENT-CHECKOUT-STOPPED",
    ],
    relationIds: checkoutRelations.map((row) => row.id),
    actorIds: actors.map((row) => row.id),
  });
  const paymentProcess = derived("PROCESS-MARKETPLACE-PAYMENT", copy.processes.payment, {
    type: "supporting",
    journeyId,
    sequence: 2,
    continuationOf: checkoutProcess.id,
    nodeRefs: [
      "events/EVENT-PAYMENT-START",
      "tasks/TASK-PAYMENT-ORDER",
      "decisions/DECISION-PAYMENT-SUCCESS",
      "tasks/TASK-PAYMENT-CORRECTION",
      "states/STATE-ORDER-CONFIRMED",
      "tasks/TASK-ROUTE-ORDER",
      "events/EVENT-PAYMENT-STOPPED",
      "events/EVENT-ORDER-HANDOFF",
    ],
    relationIds: paymentRelations.map((row) => row.id),
    actorIds: actors.map((row) => row.id),
  });
  const fulfilmentProcess = derived("PROCESS-MARKETPLACE-FULFILMENT", copy.processes.fulfilment, {
    type: "supporting",
    journeyId,
    sequence: 3,
    continuationOf: paymentProcess.id,
    nodeRefs: [
      "events/EVENT-FULFILMENT-START",
      "tasks/TASK-SELLER-ACCEPT",
      "tasks/TASK-PICK-PACK",
      "tasks/TASK-DELIVERY-HANDOFF",
      "tasks/TASK-TRACKING-UPDATE",
      "tasks/TASK-CONFIRM-RECEIPT",
      "states/STATE-DELIVERY-COMPLETED",
      "events/EVENT-FULFILMENT-COMPLETED",
      "events/EVENT-DELIVERY-ISSUE-HANDOFF",
    ],
    relationIds: fulfilmentRelations.map((row) => row.id),
    actorIds: actors.map((row) => row.id),
  });
  const supportProcess = derived("PROCESS-MARKETPLACE-SUPPORT", copy.processes.support, {
    type: "supporting",
    journeyId,
    sequence: 4,
    continuationOf: fulfilmentProcess.id,
    nodeRefs: [
      "events/EVENT-SUPPORT-CHECK-START",
      "decisions/DECISION-SUPPORT-REQUIRED",
      "tasks/TASK-SUPPORT-INTAKE",
      "tasks/TASK-SUPPORT-REVIEW",
      "decisions/DECISION-CASE-APPROVED",
      "tasks/TASK-RETURN-REFUND",
      "tasks/TASK-CLOSE-CASE",
      "events/EVENT-MARKETPLACE-END",
    ],
    relationIds: supportRelations.map((row) => row.id),
    actorIds: actors.map((row) => row.id),
  });
  return {
    tasks,
    events,
    states,
    decisions,
    processes: [checkoutProcess, paymentProcess, fulfilmentProcess, supportProcess],
    processRelations: [...checkoutRelations, ...paymentRelations, ...fulfilmentRelations, ...supportRelations],
    primaryProcessId: checkoutProcess.id,
  };
}

function relation(id, fromRef, toRef, type, label) {
  return { id, fromRef, toRef, type, label };
}

function marketplaceProcessCopy(locale = "en") {
  if (locale === "uz-Latn") return {
    actors: { buyer: "Xaridor", seller: "Sotuvchi", service: "Marketpleys xizmati", support: "Yordam operatori" },
    events: { discoveryStarted: "Mahsulot qidiruvi boshlandi", checkoutReady: "Savat to‘lovga tayyor", orderHandoff: "Buyurtma sotuvchiga yuborildi", checkoutStopped: "Savatni yangilash kerak", paymentStarted: "To‘lov boshlandi", paymentStopped: "To‘lovni takrorlash kerak", fulfilmentStarted: "Sotuvchi buyurtmani oldi", fulfilmentCompleted: "Yetkazish yakunlandi", deliveryIssueHandoff: "Yordamga yuborildi", supportCheckStarted: "Yetkazish natijasi olindi", orderCompleted: "Buyurtma yakunlandi" },
    tasks: { catalog: "Katalog va qidiruv", product: "Mahsulotni tanlash", cart: "Savat", delivery: "Manzil va yetkazib berish", validation: "Savat va qoldiqni tekshirish", correction: "Savatni yangilash", payment: "To‘lov va buyurtma yaratish", paymentCorrection: "To‘lov usulini o‘zgartirish", routeOrder: "Buyurtmani sotuvchiga yo‘naltirish", sellerAccept: "Buyurtmani qabul qilish", pickPack: "Yig‘ish va qadoqlash", deliveryHandoff: "Kuryerga topshirish", tracking: "Holat va trekni yangilash", receipt: "Qabulni tasdiqlash", supportIntake: "Yangi murojaat", supportReview: "Murojaatni tekshirish", returnRefund: "Qaytarish yoki pulni qaytarish", closeCase: "Murojaatni yopish" },
    states: { confirmed: "Buyurtma yaratildi", delivered: "Yetkazib berildi" },
    decisions: {
      stock: { label: "Mavjudlik", question: "Mahsulotlar mavjudmi?", yes: "Mavjud", no: "Mavjud emas" },
      payment: { label: "To‘lov natijasi", question: "To‘lov muvaffaqiyatlimi?", yes: "To‘landi", no: "Xato" },
      support: { label: "Istisno", question: "Yordam yoki qaytarish kerakmi?", no: "Yo‘q", yes: "Ha" },
      approval: { label: "Murojaat qarori", question: "Murojaat tasdiqlandimi?", yes: "Tasdiqlandi", no: "Rad etildi" },
    },
    relations: { cartUpdateRequired: "savatni yangilash kerak", paymentNotCompleted: "to‘lov yakunlanmadi", confirmed: "buyurtma tasdiqlandi", orderTransferred: "buyurtma yuborildi", shipmentRegistered: "jo‘natma ro‘yxatga olindi", deliveryIssue: "yetkazish muammosi", delivered: "qabul qilindi", resolved: "murojaat yopildi" },
    processes: { checkout: "Katalog, savat va qoldiq", payment: "To‘lov va buyurtma yaratish", fulfilment: "Bajarish va yetkazish", support: "Yordam va qaytarish" },
  };
  if (locale === "ru" || locale === "ru-RU") return {
    actors: { buyer: "Покупатель", seller: "Продавец", service: "Сервис маркетплейса", support: "Оператор поддержки" },
    events: { discoveryStarted: "Начат поиск товара", checkoutReady: "Корзина готова к оплате", orderHandoff: "Заказ передан продавцу", checkoutStopped: "Нужно обновить корзину", paymentStarted: "Начата оплата", paymentStopped: "Нужно повторить оплату", fulfilmentStarted: "Продавец получил заказ", fulfilmentCompleted: "Доставка завершена", deliveryIssueHandoff: "Передано в поддержку", supportCheckStarted: "Получен итог доставки", orderCompleted: "Заказ завершён" },
    tasks: { catalog: "Каталог и поиск", product: "Выбор товара и варианта", cart: "Корзина", delivery: "Адрес и способ доставки", validation: "Проверка корзины и остатков", correction: "Обновить корзину", payment: "Оплата и создание заказа", paymentCorrection: "Изменить способ оплаты", routeOrder: "Передача заказа продавцу", sellerAccept: "Принять заказ", pickPack: "Собрать и упаковать", deliveryHandoff: "Передать в доставку", tracking: "Обновить статус и трек", receipt: "Заказ получен", supportIntake: "Новое обращение", supportReview: "Проверить обращение", returnRefund: "Оформить возврат средств", closeCase: "Закрыть обращение" },
    states: { confirmed: "Заказ создан", delivered: "Заказ доставлен" },
    decisions: {
      stock: { label: "Наличие", question: "Все позиции доступны?", yes: "В наличии", no: "Нет в наличии" },
      payment: { label: "Результат оплаты", question: "Оплата прошла?", yes: "Оплачено", no: "Ошибка" },
      support: { label: "Исключение", question: "Нужен возврат или поддержка?", no: "Нет", yes: "Да" },
      approval: { label: "Решение", question: "Обращение одобрено?", yes: "Одобрено", no: "Отказ" },
    },
    relations: { cartUpdateRequired: "корзина требует изменений", paymentNotCompleted: "оплата не завершена", confirmed: "заказ подтверждён", orderTransferred: "заказ передан", shipmentRegistered: "отправление зарегистрировано", deliveryIssue: "проблема доставки", delivered: "получено", resolved: "обращение закрыто" },
    processes: { checkout: "Каталог, корзина и наличие", payment: "Оплата и создание заказа", fulfilment: "Исполнение и доставка", support: "Поддержка и возврат" },
  };
  return {
    actors: { buyer: "Buyer", seller: "Seller", service: "Marketplace service", support: "Support operator" },
    events: { discoveryStarted: "Product discovery started", checkoutReady: "Cart ready for payment", orderHandoff: "Order handed to seller", checkoutStopped: "Cart update required", paymentStarted: "Payment started", paymentStopped: "Payment retry required", fulfilmentStarted: "Seller received order", fulfilmentCompleted: "Delivery completed", deliveryIssueHandoff: "Handed to support", supportCheckStarted: "Delivery outcome received", orderCompleted: "Order completed" },
    tasks: { catalog: "Catalog and search", product: "Select product and variant", cart: "Cart", delivery: "Address and delivery method", validation: "Validate cart and stock", correction: "Update the cart", payment: "Payment and order creation", paymentCorrection: "Change payment method", routeOrder: "Route order to seller", sellerAccept: "Accept the order", pickPack: "Pick and pack", deliveryHandoff: "Hand over for delivery", tracking: "Update status and tracking", receipt: "Order received", supportIntake: "New support case", supportReview: "Review the case", returnRefund: "Arrange return or refund", closeCase: "Close the case" },
    states: { confirmed: "Order created", delivered: "Order delivered" },
    decisions: {
      stock: { label: "Availability", question: "Are all items available?", yes: "Available", no: "Unavailable" },
      payment: { label: "Payment result", question: "Did payment succeed?", yes: "Paid", no: "Failed" },
      support: { label: "Exception", question: "Is return or support required?", no: "No", yes: "Yes" },
      approval: { label: "Case decision", question: "Is the case approved?", yes: "Approved", no: "Declined" },
    },
    relations: { cartUpdateRequired: "cart update required", paymentNotCompleted: "payment not completed", confirmed: "order confirmed", orderTransferred: "order transferred", shipmentRegistered: "shipment registered", deliveryIssue: "delivery issue", delivered: "received", resolved: "case closed" },
    processes: { checkout: "Catalog, cart, and stock", payment: "Payment and order creation", fulfilment: "Fulfilment and delivery", support: "Support and return" },
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
