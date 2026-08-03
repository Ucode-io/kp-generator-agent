import { architectureLayerIdForNode } from "./kp_architecture_layers.mjs";
import {
  buildProductDeliveryInventory,
  buildProductMapModel,
  buildProductMapSegments,
} from "./kp_product_map_model.mjs";

const TRUTH_STATUSES = new Set(["explicit", "verified", "single_source", "recommended", "inferred", "assumed", "unknown"]);
const INCLUSIONS = new Set(["requested", "in_scope", "recommended", "deferred", "out_of_scope", "unknown"]);
const FACTUAL_TRUTH = new Set(["explicit", "verified", "single_source"]);
export const ROADMAP_WORKSTREAM_PAGE_LIMIT = 14;

export function buildVisualizationSpecs({ semanticModel, presentationPlan }) {
  const builders = {
    market_sizing: buildMarketSizingSpec,
    launch_boundary: buildOwnershipBoundarySpec,
    product_map: buildProductMapSpec,
    primary_flow: buildPrimaryFlowSpec,
    architecture: buildArchitectureSpec,
    roadmap: buildRoadmapSpec,
  };
  return (presentationPlan?.pages || [])
    .filter((page) => page.visualizationSpecId)
    .map((page) => {
      const builder = builders[page.kind];
      if (!builder) throw Object.assign(new Error(`No visualization builder for page kind ${page.kind}`), { code: "CONTRACT_VISUALIZATION_SPEC_INVALID" });
      const spec = builder({
        semanticModel,
        pageNumber: page.pageNumber,
        requestId: presentationPlan.requestId,
        segmentIndex: page.segmentIndex,
        segmentCount: page.segmentCount,
      });
      return {
        ...spec,
        visualizationSpecId: page.visualizationSpecId,
        pageNumber: page.pageNumber,
      };
    });
}

export function buildMarketSizingSpec({ semanticModel, requestId }) {
  const market = semanticModel?.market || {};
  const tam = normalizedMarketMetric(market.tam, market);
  const sam = normalizedMarketMetric(market.sam, market);
  const scenarios = array(market.somScenarios).map((row) => normalizedMarketMetric(row, market)).filter(Boolean).slice(0, 3);
  const context = marketContext([tam, sam, ...scenarios].filter(Boolean));
  const observedSourceReady = hasObservedFactualMarketMetric([tam, sam, ...scenarios], semanticModel?.sources);
  const numericReady = Boolean(tam && sam && scenarios.length && context.complete && observedSourceReady);

  if (!numericReady) return buildPendingMarketSpec({ requestId, market, tam, sam, scenarios, context, observedSourceReady });

  const nodes = [
    marketNode("MARKET-TAM", "TAM", tam, "neutral"),
    marketNode("MARKET-SAM", "SAM", sam, "owned"),
    ...scenarios.map((scenario, index) => marketNode(`MARKET-SOM-${index + 1}`, `SOM · ${scenario.label || `Scenario ${index + 1}`}`, scenario, "positive")),
  ];
  const edges = [
    semanticEdge("EDGE-TAM-SAM", "MARKET-TAM", "MARKET-SAM", "subset_of", {
      direction: "forward",
      semanticRole: "owned",
      truthStatus: derivedTruth([tam, sam]),
      sourceIds: unionSources([tam, sam]),
      derivationRuleId: "MARKET-SUBSET-RELATION-V1",
      label: sam.shareOfParent ? `${formatPercent(sam.shareOfParent)} of TAM` : "Serviceable subset",
    }),
    ...scenarios.map((scenario, index) => semanticEdge(`EDGE-SAM-SOM-${index + 1}`, "MARKET-SAM", `MARKET-SOM-${index + 1}`, "subset_of", {
      direction: "forward",
      semanticRole: "positive",
      truthStatus: scenario.truthStatus,
      sourceIds: scenario.sourceIds,
      derivationRuleId: scenario.derivationRuleId || "SOM-SCENARIO-V1",
      label: scenario.shareOfParent ? `${formatPercent(scenario.shareOfParent)} scenario` : "Modeled scenario",
    })),
  ];
  return baseSpec(requestId, 6, {
    kind: "nested_market",
    variant: "numeric",
    intent: "composition",
    dataState: scenarios.every((row) => FACTUAL_TRUTH.has(row.truthStatus)) ? "grounded" : "scenario",
    layout: { engine: "nested_levels", orientation: "vertical" },
    nodes,
    edges,
  });
}

function buildPendingMarketSpec({ requestId, market, tam, sam, scenarios, context, observedSourceReady }) {
  const formulas = [
    semanticNode("FORMULA-TAM", "TAM = total addressable market", "market_level", { truthStatus: "recommended", semanticRole: "neutral", derivationRuleId: "MARKET-FORMULA-V1" }),
    semanticNode("FORMULA-SAM", "SAM = TAM × serviceable segment share", "market_level", { truthStatus: "recommended", semanticRole: "owned", derivationRuleId: "MARKET-FORMULA-V1" }),
    semanticNode("FORMULA-SOM", "SOM = SAM × modeled capture-rate scenario", "market_level", { truthStatus: "recommended", semanticRole: "positive", derivationRuleId: "MARKET-FORMULA-V1" }),
  ];
  const missing = [];
  if (!tam) missing.push({ id: "MISSING-TAM", label: "To confirm: TAM value and supporting source", target: "FORMULA-TAM" });
  if (!sam) missing.push({ id: "MISSING-SAM", label: "To confirm: serviceable segment and share", target: "FORMULA-SAM" });
  if (!scenarios.length) missing.push({ id: "MISSING-SOM", label: "To confirm: capture-rate scenarios", target: "FORMULA-SOM" });
  if (!context.complete) {
    const fields = context.missing.length ? context.missing.join(", ") : "one consistent geography, period, and currency";
    missing.push({ id: "MISSING-CONTEXT", label: `To confirm: ${fields}`, target: "FORMULA-TAM" });
  }
  if (!observedSourceReady) missing.push({ id: "MISSING-OBSERVED-SOURCE", label: "To confirm: observed market metric and usable source", target: "FORMULA-TAM" });
  if (tam && !marketMetricHasSource(tam)) missing.push({ id: "MISSING-TAM-SOURCE", label: "To confirm: TAM evidence source", target: "FORMULA-TAM" });
  if (sam && !marketMetricHasSource(sam)) missing.push({ id: "MISSING-SAM-SOURCE", label: "To confirm: SAM evidence or derivation", target: "FORMULA-SAM" });
  const compactMissing = compactQuestionRows(missing, 3, "MISSING-MORE", "Additional market inputs to confirm");
  const questionNodes = compactMissing.map((row) => semanticNode(row.id, row.label, "question", { truthStatus: "unknown", inclusion: "unknown", semanticRole: "neutral" }));
  const edges = [
    semanticEdge("EDGE-FORMULA-TAM-SAM", "FORMULA-TAM", "FORMULA-SAM", "subset_of", { direction: "forward", truthStatus: "recommended", derivationRuleId: "MARKET-FORMULA-V1" }),
    semanticEdge("EDGE-FORMULA-SAM-SOM", "FORMULA-SAM", "FORMULA-SOM", "subset_of", { direction: "forward", truthStatus: "recommended", derivationRuleId: "MARKET-FORMULA-V1" }),
    ...compactMissing.map((row, index) => semanticEdge(`EDGE-MISSING-${index + 1}`, row.id, row.target || "FORMULA-TAM", "association", { direction: "none", truthStatus: "unknown", semanticRole: "neutral" })),
  ];
  return baseSpec(requestId, 6, {
    kind: "nested_market",
    variant: "formula_pending",
    intent: "composition",
    dataState: "pending",
    layout: { engine: "nested_levels", orientation: "vertical" },
    nodes: [...formulas, ...questionNodes],
    edges,
    warnings: ["Market values remain pending until the listed inputs are confirmed."],
  });
}

export function buildOwnershipBoundarySpec({ semanticModel, requestId }) {
  const scope = array(semanticModel?.scopeItems?.length ? semanticModel.scopeItems : semanticModel?.scope?.scopeItems);
  const owned = scope.filter((item) => item.ownership === "owned").slice(0, 5);
  const deferred = scope.filter((item) => item.ownership === "deferred").slice(0, 4);
  const partnerScope = scope.filter((item) => item.ownership === "partner_integrated").slice(0, 5);
  const partnerRows = uniqueEntities(array(semanticModel?.integrations).length ? semanticModel.integrations : partnerScope).slice(0, 5);
  const unknownOwnership = scope.some((item) => !["owned", "partner_integrated", "deferred", "out_of_scope"].includes(item.ownership));
  if (owned.length < 2 || unknownOwnership) return buildPendingOwnershipSpec({ requestId, scope });

  const inputEvents = buildOwnershipInputEvents(semanticModel, owned);
  const ownedNodeIds = [];
  const partnerNodeIds = [];
  const deferredNodeIds = [];
  const nodes = [];
  for (const [index, event] of inputEvents.entries()) {
    const id = `INPUT-${safeId(event.id || index + 1)}`;
    ownedNodeIds.push(id);
    nodes.push(nodeFromEntity(id, event.label || "Product input", "event", event, { groupId: "GROUP-OWNED", semanticRole: "neutral", derivationRuleId: event.derivationRuleId || "OWNERSHIP-INPUT-EVENT-V1" }));
  }
  const coreSources = unionSources(owned);
  nodes.push(semanticNode("OWNED-CORE", "Own · accountable control state", "core", {
    groupId: "GROUP-OWNED",
    semanticRole: "owned",
    truthStatus: "recommended",
    inclusion: "in_scope",
    sourceIds: coreSources,
    derivationRuleId: "OWNERSHIP-CONTROL-CORE-V1",
  }));
  ownedNodeIds.push("OWNED-CORE");
  for (const [index, item] of owned.entries()) {
    const id = `OWN-${safeId(item.id || index + 1)}`;
    ownedNodeIds.push(id);
    nodes.push(nodeFromEntity(id, `Own · ${entityLabel(item)}`, "capability", item, { groupId: "GROUP-OWNED", semanticRole: "owned", inclusion: item.inclusion }));
  }
  if (partnerRows.length) {
    for (const [index, item] of partnerRows.entries()) {
      const id = `PARTNER-${safeId(item.id || index + 1)}`;
      partnerNodeIds.push(id);
      nodes.push(nodeFromEntity(id, `Integrate · ${entityLabel(item)}`, "external_system", item, { groupId: "GROUP-PARTNER", semanticRole: "partner", inclusion: "in_scope" }));
    }
  } else {
    partnerNodeIds.push("PARTNER-NONE");
    nodes.push(semanticNode("PARTNER-NONE", "Integrate · no partner rail confirmed", "annotation", { groupId: "GROUP-PARTNER", semanticRole: "partner", truthStatus: "unknown", inclusion: "unknown" }));
  }
  if (deferred.length) {
    deferredNodeIds.push("DEFERRED-RAIL");
    nodes.push(semanticNode("DEFERRED-RAIL", "Defer · outside the launch path", "annotation", {
      groupId: "GROUP-DEFERRED",
      semanticRole: "deferred",
      truthStatus: "recommended",
      inclusion: "deferred",
      sourceIds: unionSources(deferred),
      derivationRuleId: "OWNERSHIP-DEFERRED-RAIL-V1",
    }));
    for (const [index, item] of deferred.entries()) {
      const id = `DEFER-${safeId(item.id || index + 1)}`;
      deferredNodeIds.push(id);
      nodes.push(nodeFromEntity(id, `Defer · ${entityLabel(item)}`, "capability", item, { groupId: "GROUP-DEFERRED", semanticRole: "deferred", inclusion: "deferred" }));
    }
  } else {
    deferredNodeIds.push("DEFERRED-NONE");
    nodes.push(semanticNode("DEFERRED-NONE", "Defer · no capability confirmed", "annotation", { groupId: "GROUP-DEFERRED", semanticRole: "deferred", truthStatus: "unknown", inclusion: "unknown" }));
  }

  const edges = [
    ...inputEvents.map((event, index) => semanticEdge(`EDGE-INPUT-${index + 1}-CORE`, `INPUT-${safeId(event.id || index + 1)}`, "OWNED-CORE", event.type === "message" ? "message" : "sequence", {
      semanticRole: "owned",
      truthStatus: event.truthStatus || "recommended",
      sourceIds: event.sourceIds,
      derivationRuleId: event.derivationRuleId || "OWNERSHIP-INPUT-EVENT-V1",
      label: "enters control",
    })),
    ...owned.map((item, index) => semanticEdge(`EDGE-CORE-OWN-${index + 1}`, "OWNED-CORE", `OWN-${safeId(item.id || index + 1)}`, "association", {
      direction: "none",
      semanticRole: "owned",
      truthStatus: item.truthStatus,
      sourceIds: item.sourceIds,
      derivationRuleId: item.derivationRuleId,
      label: "owned capability",
    })),
    ...partnerRows.flatMap((item, index) => {
      const id = `PARTNER-${safeId(item.id || index + 1)}`;
      return [
        semanticEdge(`EDGE-CORE-PARTNER-${index + 1}`, "OWNED-CORE", id, "request", { semanticRole: "partner", truthStatus: item.truthStatus, sourceIds: item.sourceIds, derivationRuleId: item.derivationRuleId, label: "request / message" }),
        semanticEdge(`EDGE-PARTNER-CORE-${index + 1}`, id, "OWNED-CORE", "callback", { semanticRole: "partner", truthStatus: item.truthStatus, sourceIds: item.sourceIds, derivationRuleId: item.derivationRuleId, label: "callback / status" }),
      ];
    }),
    ...deferred.map((item, index) => semanticEdge(`EDGE-DEFERRED-${index + 1}`, "DEFERRED-RAIL", `DEFER-${safeId(item.id || index + 1)}`, "association", {
      direction: "none",
      semanticRole: "deferred",
      truthStatus: item.truthStatus,
      sourceIds: item.sourceIds,
      derivationRuleId: item.derivationRuleId,
      label: "outside launch path",
    })),
  ];
  const groups = [
    semanticGroup("GROUP-OWNED", "Own · product control", "boundary", "owned", ownedNodeIds, owned, "OWNERSHIP-OWNED-GROUP-V1"),
    semanticGroup("GROUP-PARTNER", "Integrate · partner rails", "boundary", "partner", partnerNodeIds, partnerRows, "OWNERSHIP-PARTNER-GROUP-V1"),
    semanticGroup("GROUP-DEFERRED", "Defer · outside launch", "boundary", "deferred", deferredNodeIds, deferred, "OWNERSHIP-DEFERRED-GROUP-V1"),
  ];
  return baseSpec(requestId, 8, {
    kind: "ownership_boundary",
    variant: "complete",
    intent: "relationship",
    dataState: nodes.some((item) => !FACTUAL_TRUTH.has(item.truthStatus)) ? "mixed" : "grounded",
    layout: { engine: "boundary_flow", orientation: "horizontal" },
    nodes,
    edges,
    groups,
  });
}

function buildPendingOwnershipSpec({ requestId, scope }) {
  const questions = [
    semanticNode("OWNERSHIP-Q-OWN", "Own · which capabilities require accountable control?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "GROUP-OWNERSHIP-QUESTIONS" }),
    semanticNode("OWNERSHIP-Q-PARTNER", "Integrate · which partner rails are required?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "GROUP-OWNERSHIP-QUESTIONS", semanticRole: "partner" }),
    semanticNode("OWNERSHIP-Q-DEFER", "Defer · which capabilities stay outside launch?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "GROUP-OWNERSHIP-QUESTIONS", semanticRole: "deferred" }),
  ];
  return baseSpec(requestId, 8, {
    kind: "ownership_boundary",
    variant: "pending",
    intent: "relationship",
    dataState: "pending",
    layout: { engine: "questions", orientation: "horizontal" },
    nodes: questions,
    edges: [],
    groups: [semanticGroup("GROUP-OWNERSHIP-QUESTIONS", "Ownership boundaries to confirm", "scenario_set", "neutral", questions.map((row) => row.id), scope, "OWNERSHIP-QUESTIONS-V1")],
    warnings: ["Ownership is not sufficiently grounded for a launch-boundary flow."],
  });
}

export function buildProductMapSpec({ semanticModel, requestId, pageNumber = 10, segmentIndex = 1, segmentCount = null }) {
  const productModel = buildProductMapModel(semanticModel);
  if (!productModel.branches.some((branch) => array(branch.functions).length)) return buildPendingProductMapSpec(requestId, productModel, pageNumber);
  const segments = buildProductMapSegments(semanticModel);
  const effectiveSegmentIndex = Number(segmentIndex) || 1;
  if (!Number.isInteger(effectiveSegmentIndex) || effectiveSegmentIndex < 1 || effectiveSegmentIndex > segments.length) {
    throw Object.assign(new Error(`Product-map segment ${segmentIndex} is outside 1..${segments.length}`), { code: "CONTRACT_VISUALIZATION_SPEC_INVALID" });
  }
  if (segmentCount !== null && segmentCount !== undefined && Number(segmentCount) !== segments.length) {
    throw Object.assign(new Error(`Product-map segment count drift: plan=${segmentCount}, model=${segments.length}`), { code: "CONTRACT_VISUALIZATION_SPEC_INVALID" });
  }
  const segment = segments[effectiveSegmentIndex - 1];
  const rootEntity = semanticModel?.project || {};
  const rootTruth = array(rootEntity.sourceIds).length ? "explicit" : "recommended";
  const root = nodeFromEntity("PRODUCT-CORE", rootEntity.name || "Product core", "core", rootEntity, {
    semanticRole: "owned",
    truthStatus: rootTruth,
    inclusion: "in_scope",
    sourceIds: rootEntity.sourceIds,
    derivationRuleId: rootTruth === "explicit" ? null : "PRODUCT-CORE-V1",
  });
  const nodes = [root];
  const edges = [];
  const usedLabels = new Set([normalizeLabelKey(root.label)]);

  for (const [branchIndex, branch] of segment.branches.entries()) {
    const branchId = `DOMAIN-${safeId(branch.id || branchIndex + 1)}`;
    const branchLabel = uniqueVisibleLabel(branch.label, usedLabels, `Domain ${branchIndex + 1}`);
    const branchTruth = derivedTruth(branch.sourceRows || branch.functions);
    const branchSources = unionSources(branch.sourceRows || branch.functions);
    const branchRule = (branch.sourceRows || []).find((row) => row.derivationRuleId)?.derivationRuleId
      || (FACTUAL_TRUTH.has(branchTruth) && branchSources.length ? null : "PRODUCT-DOMAIN-GROUP-V1");
    nodes.push(semanticNode(branchId, branchLabel, "domain", {
      semanticRole: "owned",
      truthStatus: branchTruth,
      inclusion: "in_scope",
      sourceIds: branchSources,
      derivationRuleId: branchRule,
    }));
    edges.push(semanticEdge(`EDGE-ROOT-${branchIndex + 1}`, root.id, branchId, "association", {
      semanticRole: "owned",
      truthStatus: branchTruth,
      sourceIds: branchSources,
      derivationRuleId: branchRule || "PRODUCT-DOMAIN-RELATION-V1",
    }));
    for (const [functionIndex, entity] of branch.functions.entries()) {
      const functionId = `CAP-${safeId(entity.id || `${branchIndex + 1}-${functionIndex + 1}`)}`;
      const functionLabel = uniqueVisibleLabel(entity.label || entityLabel(entity), usedLabels, branch.label);
      nodes.push(nodeFromEntity(functionId, functionLabel, "capability", entity, {
        semanticRole: "owned",
        inclusion: entity.inclusion || "in_scope",
        dataRef: entity.dataRef || null,
      }));
      edges.push(semanticEdge(`EDGE-${branchIndex + 1}-CAP-${functionIndex + 1}`, branchId, functionId, "association", {
        semanticRole: "owned",
        truthStatus: entity.truthStatus,
        sourceIds: entity.sourceIds,
        derivationRuleId: entity.derivationRuleId || "PRODUCT-CAPABILITY-PARENT-V1",
      }));
      for (const [detailIndex, detail] of array(entity.details).entries()) {
        const detailId = `SUB-${safeId(detail.id || `${entity.id || `${branchIndex + 1}-${functionIndex + 1}`}-${detailIndex + 1}`)}`;
        const detailLabel = uniqueVisibleLabel(detail.label, usedLabels, functionLabel);
        nodes.push(semanticNode(detailId, detailLabel, "subfunction", {
          semanticRole: "neutral",
          truthStatus: detail.truthStatus || entity.truthStatus,
          inclusion: detail.inclusion || entity.inclusion || "in_scope",
          sourceIds: detail.sourceIds || entity.sourceIds,
          derivationRuleId: detail.derivationRuleId || entity.derivationRuleId || "PRODUCT-SUBFUNCTION-V1",
          dataRef: detail.dataRef || null,
          fullLabel: detail.label,
        }));
        edges.push(semanticEdge(`EDGE-${branchIndex + 1}-SUB-${functionIndex + 1}-${detailIndex + 1}`, functionId, detailId, "association", {
          semanticRole: "neutral",
          truthStatus: detail.truthStatus || entity.truthStatus,
          sourceIds: detail.sourceIds || entity.sourceIds,
          derivationRuleId: detail.derivationRuleId || entity.derivationRuleId || "PRODUCT-SUBFUNCTION-PARENT-V1",
        }));
      }
    }
  }
  return baseSpec(requestId, pageNumber, {
    kind: "hub_spoke",
    variant: "left_to_right_tree",
    intent: "hierarchy",
    dataState: nodes.some((row) => !FACTUAL_TRUTH.has(row.truthStatus)) ? "mixed" : "grounded",
    layout: { engine: "left_to_right_tree", orientation: "horizontal" },
    nodes,
    edges,
    segmentIndex: effectiveSegmentIndex,
    segmentCount: segments.length,
    warnings: segments.length > 1 ? [`Mind map continuation ${effectiveSegmentIndex} of ${segments.length}; hierarchy repeated for readability.`] : [],
  });
}

function buildPendingProductMapSpec(requestId, branchModel, pageNumber = 10) {
  const nodes = [
    semanticNode("PRODUCT-Q-ROOT", "Product map to confirm", "question", { truthStatus: "unknown", inclusion: "unknown" }),
    semanticNode("PRODUCT-Q-DOMAINS", "Which product domains connect to the accountable core?", "question", { truthStatus: "unknown", inclusion: "unknown" }),
    semanticNode("PRODUCT-Q-SURFACES", "Which user and operator surfaces belong to each domain?", "question", { truthStatus: "unknown", inclusion: "unknown" }),
  ];
  return baseSpec(requestId, pageNumber, {
    kind: "hub_spoke",
    variant: "pending",
    intent: "hierarchy",
    dataState: "pending",
    layout: { engine: "questions", orientation: "horizontal" },
    segmentIndex: 1,
    segmentCount: 1,
    nodes,
    edges: [],
    warnings: [`Only ${branchModel.branches.length} grounded product branch(es) were available; at least two are required.`],
  });
}

export function primaryFlowProcesses(semanticModel = {}) {
  const processes = array(semanticModel?.processes);
  const primary = processes.find((row) => row.id === semanticModel?.primaryProcessId) || processes.find((row) => row.type === "primary");
  if (!primary) return [];
  const sourceOrder = new Map(processes.map((row, index) => [row.id, index]));
  const compareProcessOrder = (left, right) => {
    const leftSequence = Number.isFinite(Number(left.sequence)) ? Number(left.sequence) : sourceOrder.get(left.id) || 0;
    const rightSequence = Number.isFinite(Number(right.sequence)) ? Number(right.sequence) : sourceOrder.get(right.id) || 0;
    return leftSequence - rightSequence || (sourceOrder.get(left.id) || 0) - (sourceOrder.get(right.id) || 0);
  };
  const selected = [primary];
  const selectedIds = new Set([primary.id]);
  let added = true;
  while (added) {
    added = false;
    const next = processes
      .filter((row) => row.type === "supporting" && !selectedIds.has(row.id) && selectedIds.has(row.continuationOf))
      .sort(compareProcessOrder);
    for (const row of next) {
      selected.push(row);
      selectedIds.add(row.id);
      added = true;
    }
  }
  return selected.sort(compareProcessOrder);
}

export function primaryFlowSegmentCount(semanticModel = {}) {
  return Math.max(1, primaryFlowProcesses(semanticModel).length);
}

export function buildPrimaryFlowSpec({ semanticModel, requestId, pageNumber = 12, segmentIndex = 1, segmentCount = null }) {
  const processSegments = primaryFlowProcesses(semanticModel);
  const effectiveSegmentCount = Math.max(1, processSegments.length);
  const effectiveSegmentIndex = Number(segmentIndex) || 1;
  const questionsFallback = (reason) => buildProcessQuestionsSpec(requestId, reason, {
    pageNumber,
    segmentIndex: effectiveSegmentIndex,
    segmentCount: effectiveSegmentCount,
  });
  if (!processSegments.length) return questionsFallback("No grounded primary process was supplied");
  if (!Number.isInteger(effectiveSegmentIndex) || effectiveSegmentIndex < 1 || effectiveSegmentIndex > processSegments.length) {
    throw Object.assign(new Error(`Primary-flow segment ${segmentIndex} is outside 1..${processSegments.length}`), { code: "CONTRACT_VISUALIZATION_SPEC_INVALID" });
  }
  if (segmentCount !== null && segmentCount !== undefined && Number(segmentCount) !== processSegments.length) {
    throw Object.assign(new Error(`Primary-flow segment count drift: plan=${segmentCount}, model=${processSegments.length}`), { code: "CONTRACT_VISUALIZATION_SPEC_INVALID" });
  }
  const process = processSegments[effectiveSegmentIndex - 1];
  const entityLookup = buildProcessEntityLookup(semanticModel);
  const relationLookup = new Map(array(semanticModel?.processRelations).map((row) => [row.id, row]));
  const refs = array(process.nodeRefs);
  const relations = array(process.relationIds).map((id) => relationLookup.get(id)).filter(Boolean);
  if (!refs.length || !relations.length || relations.length !== array(process.relationIds).length) {
    return questionsFallback("The primary process has no complete, grounded sequence");
  }

  const actors = new Map(array(semanticModel?.actors).map((row) => [row.id, row]));
  const refToNodeId = new Map();
  const nodes = [];
  for (const [index, ref] of refs.entries()) {
    const resolved = entityLookup.get(ref);
    if (!resolved) return questionsFallback(`Process node ${index + 1} is unresolved`);
    const nodeId = `FLOW-${resolved.collection.toUpperCase()}-${safeId(resolved.entity.id)}`;
    refToNodeId.set(ref, nodeId);
    const visualType = processVisualType(resolved.collection, resolved.entity);
    const actorId = resolved.entity.actorId || null;
    if (visualType === "task" && (!actorId || !actors.has(actorId))) return questionsFallback("Every process task needs a confirmed actor");
    if (actorId && !actors.has(actorId)) return questionsFallback(`Process node ${index + 1} references an unknown actor`);
    const laneId = actorId ? `LANE-${safeId(actorId)}` : null;
    nodes.push(nodeFromEntity(nodeId, entityLabel(resolved.entity), visualType, resolved.entity, {
      semanticRole: actorId && ["partner_actor", "system_actor"].includes(actors.get(actorId)?.type) ? "partner" : visualType === "end_event" ? "positive" : "owned",
      inclusion: "in_scope",
      groupId: laneId,
      lane: laneId,
      dataRef: `/${resolved.collection}/${resolved.index}`,
    }));
  }
  const edges = [];
  for (const [index, relation] of relations.entries()) {
    const from = refToNodeId.get(relation.fromRef);
    const to = refToNodeId.get(relation.toRef);
    if (!from || !to) return questionsFallback(`Process relation ${index + 1} has an unresolved endpoint`);
    const type = processEdgeType(relation.type);
    const label = relation.label || processRelationLabel(relation.type);
    edges.push(semanticEdge(`FLOW-EDGE-${safeId(relation.id || index + 1)}`, from, to, type, {
      semanticRole: type === "exception" ? "risk" : type === "message" ? "partner" : "owned",
      truthStatus: process.truthStatus,
      sourceIds: process.sourceIds,
      derivationRuleId: process.derivationRuleId || (FACTUAL_TRUTH.has(process.truthStatus) ? null : "PROCESS-RELATION-V1"),
      label,
      dataRef: `/processRelations/${array(semanticModel?.processRelations).indexOf(relation)}`,
    }));
  }
  if (!assignDeterministicProcessLanes(nodes, edges)) {
    return questionsFallback("Every process node needs one unambiguous actor lane");
  }
  const laneIds = unique(nodes.filter(isLaneOwnedProcessNode).map((row) => row.lane));
  if (laneIds.length > 6) return questionsFallback("The primary process exceeds the six-lane readability limit");
  const groups = laneIds.map((laneId) => {
    const actorId = laneId.slice("LANE-".length);
    const actor = array(semanticModel?.actors).find((row) => safeId(row.id) === actorId) || {};
    const nodeIds = nodes.filter((row) => row.lane === laneId).map((row) => row.id);
    return semanticGroup(laneId, actor.label || "Process actor", "lane", ["partner_actor", "system_actor"].includes(actor.type) ? "partner" : "owned", nodeIds, [actor], "PROCESS-LANE-V1");
  });
  const candidate = baseSpec(requestId, pageNumber, {
    kind: "bpmn",
    variant: nodes.some((row) => row.type === "gateway") || groups.length > 1 ? "swimlane" : "linear",
    intent: "process",
    dataState: nodes.every((row) => FACTUAL_TRUTH.has(row.truthStatus)) ? "grounded" : "mixed",
    layout: { engine: nodes.some((row) => row.type === "gateway") || groups.length > 1 ? "swimlane" : "linear_flow", orientation: "horizontal" },
    nodes,
    edges,
    groups,
    segmentIndex: effectiveSegmentIndex,
    segmentCount: effectiveSegmentCount,
    warnings: effectiveSegmentCount > 1
      ? [`Primary-flow continuation ${effectiveSegmentIndex} of ${effectiveSegmentCount}; each page preserves a complete start-to-outcome subprocess.`]
      : [],
  });
  if (!isTrustworthyProcessSpec(candidate)) return questionsFallback("The supplied process does not form a valid start-to-outcome path");
  return candidate;
}

function buildProcessQuestionsSpec(requestId, reason, { pageNumber = 12, segmentIndex = 1, segmentCount = 1 } = {}) {
  const nodes = [
    semanticNode("PROCESS-QUESTIONS-TITLE", "Process questions: confirm the primary flow", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "GROUP-PROCESS-QUESTIONS" }),
    semanticNode("PROCESS-QUESTIONS-ACTOR", "Who starts the process and who owns each task?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "GROUP-PROCESS-QUESTIONS" }),
    semanticNode("PROCESS-QUESTIONS-SEQUENCE", "What is the trusted order of tasks and messages?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "GROUP-PROCESS-QUESTIONS" }),
    semanticNode("PROCESS-QUESTIONS-OUTCOME", "Which decisions, exceptions, and outcomes close the flow?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "GROUP-PROCESS-QUESTIONS" }),
  ];
  return baseSpec(requestId, pageNumber, {
    kind: "bpmn",
    variant: "questions",
    intent: "process",
    dataState: "pending",
    layout: { engine: "questions", orientation: "horizontal" },
    nodes,
    edges: [],
    groups: [semanticGroup("GROUP-PROCESS-QUESTIONS", "Process questions", "scenario_set", "neutral", nodes.map((row) => row.id), [], "PROCESS-QUESTIONS-V1")],
    segmentIndex,
    segmentCount,
    warnings: [reason],
  });
}

export function buildArchitectureSpec({ semanticModel, requestId }) {
  const architecture = semanticModel?.architecture || {};
  const components = array(architecture.components);
  const relations = array(architecture.relations);
  if (!components.length) return buildPendingArchitectureSpec(requestId, "No grounded architecture components were supplied");

  const componentIdMap = new Map();
  const boundaryByComponent = new Map();
  for (const boundary of array(architecture.boundaries)) {
    for (const componentId of array(boundary.componentIds)) {
      if (!boundaryByComponent.has(componentId) || boundary.type === "trusted_product") boundaryByComponent.set(componentId, boundary);
    }
  }
  const componentNodes = components.map((component, index) => {
    const id = `ARCH-${safeId(component.id || index + 1)}`;
    componentIdMap.set(component.id, id);
    const boundary = boundaryByComponent.get(component.id);
    const groupId = boundary ? `ARCH-GROUP-${safeId(boundary.id)}` : component.kind === "external" || component.semanticRole === "partner" ? "ARCH-GROUP-EXTERNAL" : "ARCH-GROUP-TRUSTED";
    const type = architectureNodeType(component.kind);
    return nodeFromEntity(id, entityLabel(component), type, component, {
      semanticRole: component.kind === "external" ? "partner" : component.semanticRole,
      inclusion: component.kind === "external" ? "in_scope" : "in_scope",
      groupId,
      lane: architectureLayerIdForNode({ type }),
      dataRef: `/architecture/components/${index}`,
    });
  });
  const channels = componentNodes.filter((row) => row.type === "channel");
  const actorCandidates = array(semanticModel?.actors).filter((actor) => actor?.type !== "system_actor");
  const actorLimit = Math.min(4, Math.max(0, 18 - componentNodes.length));
  const actorEntries = channels.length ? actorCandidates.slice(0, actorLimit) : [];
  const actorNodes = actorEntries.map((actor, index) => nodeFromEntity(`ARCH-ACTOR-${safeId(actor.id || index + 1)}`, entityLabel(actor), "surface", actor, {
    semanticRole: "neutral",
    inclusion: "in_scope",
    groupId: "ARCH-GROUP-USERS",
    lane: "ARCH-LAYER-USERS",
    dataRef: `/actors/${array(semanticModel?.actors).indexOf(actor)}`,
  }));
  const componentEdges = relations.map((relation, index) => semanticEdge(`ARCH-EDGE-${safeId(relation.id || index + 1)}`, componentIdMap.get(relation.from) || `UNKNOWN-${safeId(relation.from)}`, componentIdMap.get(relation.to) || `UNKNOWN-${safeId(relation.to)}`, relation.type, {
    direction: relation.direction,
    semanticRole: architectureRelationRole(relation, components),
    truthStatus: derivedTruth(components.filter((row) => row.id === relation.from || row.id === relation.to)),
    sourceIds: unionSources(components.filter((row) => row.id === relation.from || row.id === relation.to)),
    derivationRuleId: "ARCHITECTURE-RELATION-V1",
    label: architectureRelationLabel(relation.type),
    dataRef: `/architecture/relations/${index}`,
  }));
  const actorEdges = actorNodes.map((actorNode, index) => {
    const channel = channels[index % channels.length];
    const actor = actorEntries[index];
    const component = components.find((row) => componentIdMap.get(row.id) === channel.id);
    return semanticEdge(`ARCH-EDGE-${safeId(actorNode.id)}-${safeId(channel.id)}`, actorNode.id, channel.id, "request", {
      direction: "forward",
      semanticRole: "neutral",
      truthStatus: derivedTruth([actor, component].filter(Boolean)),
      sourceIds: unionSources([actor, component].filter(Boolean)),
      derivationRuleId: "ARCHITECTURE-ACTOR-ACCESS-V1",
      label: "access",
    });
  });
  const nodes = [...actorNodes, ...componentNodes];
  const edges = [...actorEdges, ...componentEdges];
  const groups = buildArchitectureGroups(architecture, componentNodes, components);
  if (actorNodes.length) groups.unshift(semanticGroup("ARCH-GROUP-USERS", "User types", "track", "neutral", actorNodes.map((row) => row.id), actorEntries, "ARCHITECTURE-ACTOR-LAYER-V1"));
  const coreNodes = componentNodes.filter((row) => ["application", "service"].includes(row.type));
  const dataStores = componentNodes.filter((row) => row.type === "data_store");
  const externals = componentNodes.filter((row) => row.type === "external_system");
  const topology = { nodes, edges };
  const core = coreNodes[0];
  const endpointsValid = componentEdges.every((row) => componentNodes.some((node) => node.id === row.from) && componentNodes.some((node) => node.id === row.to));
  const externalsConnected = externals.every((row) => componentEdges.some((edge) => edge.from === row.id || edge.to === row.id));
  if (!core || !componentEdges.length || !endpointsValid || !externalsConnected) {
    return buildPendingArchitectureSpec(requestId, "Architecture components exist, but their trusted topology is incomplete", components);
  }
  const channelPathsValid = channels.length && channels.every((row) => directedReachable(topology, row.id, { includeDirectionNone: false }).has(core.id));
  const trustedGroup = groups.find((row) => row.semanticRole === "owned" && row.type === "boundary");
  if (!trustedGroup?.nodeIds?.length) return buildPendingArchitectureSpec(requestId, "The trusted-product boundary has no confirmed components", components);

  const annotations = [];
  if (!actorNodes.length) annotations.push(semanticNode("ARCH-Q-USERS", "User types to confirm", "question", { truthStatus: "unknown", inclusion: "unknown", lane: "ARCH-LAYER-USERS" }));
  if (!channels.length) annotations.push(semanticNode("ARCH-Q-CHANNELS", "User platforms to confirm", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: trustedGroup.id, lane: "ARCH-LAYER-PLATFORMS" }));
  if (!dataStores.length) annotations.push(semanticNode("ARCH-Q-DATA", "Data requirements to confirm", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: trustedGroup.id, lane: "ARCH-LAYER-DATA" }));
  if (!externals.length) annotations.push(semanticNode("ARCH-Q-INTEGRATIONS", "No external integrations confirmed", "annotation", { truthStatus: "unknown", inclusion: "unknown", lane: "ARCH-LAYER-INTEGRATIONS" }));
  if (annotations.length) {
    trustedGroup.nodeIds.push(...annotations.filter((row) => row.groupId === trustedGroup.id).map((row) => row.id));
    const platformQuestion = annotations.find((row) => row.id === "ARCH-Q-CHANNELS");
    const userQuestion = annotations.find((row) => row.id === "ARCH-Q-USERS");
    const dataQuestion = annotations.find((row) => row.id === "ARCH-Q-DATA");
    const integrationQuestion = annotations.find((row) => row.id === "ARCH-Q-INTEGRATIONS");
    if (userQuestion && channels[0]) edges.unshift(semanticEdge("ARCH-EDGE-Q-USERS-PLATFORM", userQuestion.id, channels[0].id, "association", { direction: "none", truthStatus: "unknown", inclusion: "unknown" }));
    if (userQuestion && platformQuestion) edges.unshift(semanticEdge("ARCH-EDGE-Q-USERS-Q-PLATFORM", userQuestion.id, platformQuestion.id, "association", { direction: "none", truthStatus: "unknown", inclusion: "unknown" }));
    if (platformQuestion) edges.push(semanticEdge("ARCH-EDGE-Q-PLATFORM-CORE", platformQuestion.id, core.id, "association", { direction: "none", truthStatus: "unknown", inclusion: "unknown" }));
    if (dataQuestion) edges.push(semanticEdge("ARCH-EDGE-CORE-Q-DATA", core.id, dataQuestion.id, "association", { direction: "none", truthStatus: "unknown", inclusion: "unknown" }));
    if (integrationQuestion) edges.push(semanticEdge("ARCH-EDGE-CORE-Q-INTEGRATIONS", core.id, integrationQuestion.id, "association", { direction: "none", truthStatus: "unknown", inclusion: "unknown" }));
    return baseSpec(requestId, 13, {
      kind: "architecture",
      variant: "context",
      intent: "architecture",
      dataState: "pending",
      layout: { engine: "context", orientation: "horizontal" },
      nodes: [...nodes, ...annotations],
      edges,
      groups,
      warnings: ["The context diagram preserves known topology and marks missing layers to confirm."],
    });
  }
  if (!channelPathsValid) return buildPendingArchitectureSpec(requestId, "At least one channel has no path to the product core", components);
  return baseSpec(requestId, 13, {
    kind: "architecture",
    variant: "layered",
    intent: "architecture",
    dataState: nodes.some((row) => !FACTUAL_TRUTH.has(row.truthStatus)) ? "mixed" : "grounded",
    layout: { engine: "layered", orientation: "horizontal" },
    nodes,
    edges,
    groups,
  });
}

function buildPendingArchitectureSpec(requestId, reason, components = []) {
  const known = components.slice(0, 3).map((row) => entityLabel(row)).filter(Boolean);
  const nodes = [
    semanticNode("ARCH-Q-USERS", "Which user types access the product?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "ARCH-GROUP-QUESTIONS", lane: "ARCH-LAYER-USERS" }),
    semanticNode("ARCH-Q-CHANNEL", "Which user platforms connect to the product core?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "ARCH-GROUP-QUESTIONS", lane: "ARCH-LAYER-PLATFORMS" }),
    semanticNode("ARCH-Q-BOUNDARY", "Define the trusted backend boundary", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "ARCH-GROUP-QUESTIONS", lane: "ARCH-LAYER-BACKEND" }),
    semanticNode("ARCH-Q-DATA", "Which data stores are required?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "ARCH-GROUP-QUESTIONS", lane: "ARCH-LAYER-DATA" }),
    semanticNode("ARCH-Q-INTEGRATIONS", "Which external integrations cross the boundary?", "question", { truthStatus: "unknown", inclusion: "unknown", groupId: "ARCH-GROUP-QUESTIONS", lane: "ARCH-LAYER-INTEGRATIONS" }),
    ...(known.length ? [semanticNode("ARCH-KNOWN-INVENTORY", `Known inventory: ${known.join(", ")}`, "annotation", { truthStatus: "unknown", inclusion: "unknown", groupId: "ARCH-GROUP-QUESTIONS", lane: "ARCH-LAYER-BACKEND" })] : []),
  ];
  return baseSpec(requestId, 13, {
    kind: "architecture",
    variant: "pending",
    intent: "architecture",
    dataState: "pending",
    layout: { engine: "questions", orientation: "horizontal" },
    nodes,
    edges: [],
    groups: [semanticGroup("ARCH-GROUP-QUESTIONS", "Architecture context to confirm", "scenario_set", "neutral", nodes.map((row) => row.id), components, "ARCHITECTURE-QUESTIONS-V1")],
    warnings: [reason],
  });
}

export function buildRoadmapWorkstreamSegments(semanticModel = {}, { maxRows = ROADMAP_WORKSTREAM_PAGE_LIMIT } = {}) {
  const pageSize = Math.max(1, Math.floor(Number(maxRows) || ROADMAP_WORKSTREAM_PAGE_LIMIT));
  const normalizedInventory = normalizeDeliveryInventory(buildProductDeliveryInventory(semanticModel));
  // Keep scheduling coordinates global. Continuation pages must not restart
  // the heuristic at their first row and place later tasks back at the start.
  const inventory = normalizedInventory.map((row, index) => ({
    ...row,
    scheduleIndex: index,
    scheduleCount: normalizedInventory.length,
  }));
  if (!inventory.length) return [];
  const segmentCount = Math.max(1, Math.ceil(inventory.length / pageSize));
  const balancedSize = Math.ceil(inventory.length / segmentCount);
  return Array.from({ length: segmentCount }, (_, index) => inventory.slice(index * balancedSize, (index + 1) * balancedSize))
    .filter((rows) => rows.length);
}

export function roadmapWorkstreamSegmentCount(semanticModel = {}, options = {}) {
  return Math.max(1, buildRoadmapWorkstreamSegments(semanticModel, options).length);
}

export function buildRoadmapSpec({ semanticModel, requestId, pageNumber = 18, segmentIndex = 1, segmentCount = null }) {
  const roadmap = semanticModel?.roadmap || {};
  const phases = array(roadmap.phases);
  const workstreamSegments = buildRoadmapWorkstreamSegments(semanticModel);
  const effectiveSegmentIndex = workstreamSegments.length ? Number(segmentIndex) || 1 : 1;
  const effectiveSegmentCount = Math.max(1, workstreamSegments.length);
  const segmentOptions = { pageNumber, segmentIndex: effectiveSegmentIndex, segmentCount: effectiveSegmentCount };
  if (workstreamSegments.length) {
    if (!Number.isInteger(effectiveSegmentIndex) || effectiveSegmentIndex < 1 || effectiveSegmentIndex > workstreamSegments.length) {
      throw Object.assign(new Error(`Roadmap segment ${segmentIndex} is outside 1..${workstreamSegments.length}`), { code: "CONTRACT_VISUALIZATION_SPEC_INVALID" });
    }
    if (segmentCount !== null && segmentCount !== undefined && Number(segmentCount) !== workstreamSegments.length) {
      throw Object.assign(new Error(`Roadmap segment count drift: plan=${segmentCount}, model=${workstreamSegments.length}`), { code: "CONTRACT_VISUALIZATION_SPEC_INVALID" });
    }
  }
  if (!phases.length || isSyntheticDefaultRoadmap(phases, roadmap)) return buildPendingRoadmapSpec(requestId, "Roadmap phases and acceptance gates were not supplied", phases, segmentOptions);
  if (phases.length > 10) return buildPendingRoadmapSpec(requestId, "Roadmap exceeds ten visible phases; confirm an aggregation hierarchy", phases, segmentOptions);
  if (!workstreamSegments.length) return buildPendingRoadmapSpec(requestId, "Roadmap functional workstreams were not supplied", phases, segmentOptions);
  const scale = normalizedTimeScale(roadmap.timeScale);
  if (!scale) return buildPendingRoadmapSpec(requestId, "Roadmap duration or canonical time scale is missing or conflicting", phases, segmentOptions);

  const converted = phases.map((phase) => ({ phase, time: convertTimeToScale(phase.time, scale) }));
  const invalid = converted.filter((row) => row.time?.invalid || (row.time && (row.time.start < scale.start || row.time.end > scale.end)));
  const withTime = converted.filter((row) => row.time && !row.time.invalid);
  const withoutTime = converted.filter((row) => !row.time);
  if (invalid.length || (withTime.length && withoutTime.length)) return buildPendingRoadmapSpec(requestId, "Roadmap periods conflict or only some phases have trustworthy spans", phases, segmentOptions);

  const dependencies = array(roadmap.dependencies);
  const phaseIds = new Set(phases.map((row) => row.id));
  if (dependencies.some((row) => !phaseIds.has(row.fromPhaseId) || !phaseIds.has(row.toPhaseId))) {
    return buildPendingRoadmapSpec(requestId, "Roadmap dependency references an unknown phase", phases, segmentOptions);
  }
  const milestoneOnly = !withTime.length || converted.every((row) => row.time.start === row.time.end) || phases.every((row) => /^(soon|later|final stage|скоро|позже|финальный этап)$/iu.test(String(row.label || "").trim()));
  if (milestoneOnly) return buildMilestoneRoadmapSpec({ requestId, phases, converted, dependencies, scale, ...segmentOptions });

  const phaseNodes = converted.map(({ phase, time }, index) => nodeFromEntity(`ROADMAP-${safeId(phase.id || index + 1)}`, entityLabel(phase), "phase", phase, {
    semanticRole: phase.inclusion === "deferred" ? "deferred" : "owned",
    inclusion: phase.inclusion,
    time,
    dataRef: `/roadmap/phases/${index}`,
    derivationRuleId: time.derived ? phase.derivationRuleId || "MONTH-TO-WEEK-V1" : phase.derivationRuleId,
  }));
  const workstreamNodes = workstreamSegments[effectiveSegmentIndex - 1].map((row, index) => roadmapWorkstreamNode(row, index, scale));
  const nodes = [...phaseNodes, ...workstreamNodes];
  const edges = dependencies.map((dependency, index) => dependencyEdge(dependency, index, phases));
  return baseSpec(requestId, pageNumber, {
    kind: "gantt",
    variant: "gantt",
    intent: "schedule",
    dataState: nodes.some((row) => !FACTUAL_TRUTH.has(row.truthStatus)) ? "mixed" : "grounded",
    layout: { engine: "gantt", orientation: "horizontal" },
    timeScale: scale,
    nodes,
    edges,
    segmentIndex: effectiveSegmentIndex,
    segmentCount: effectiveSegmentCount,
    warnings: workstreamSegments.length > 1
      ? [`Roadmap continuation ${effectiveSegmentIndex} of ${workstreamSegments.length}; phase bands repeat while functional workstreams continue.`]
      : [],
  });
}

function normalizeDeliveryInventory(value) {
  const rows = Array.isArray(value)
    ? value
    : array(value?.rows).length
      ? value.rows
      : array(value?.items).length
        ? value.items
        : array(value?.terminals);
  return rows.map((row, index) => ({
    ...row,
    productLeafId: String(row?.productLeafId || row?.nodeId || row?.id || `DELIVERY-LEAF-${index + 1}`),
    label: entityLabel({
      label: row?.subfunctionLabel || row?.detailLabel || row?.detail || row?.label || row?.name || row?.functionLabel || row?.feature,
    }),
  }));
}

function roadmapWorkstreamNode(row, index, scale) {
  const time = roadmapWorkstreamTime(row, index, scale);
  return semanticNode(row.productLeafId, row.label, "task", {
    semanticRole: row.inclusion === "deferred" ? "deferred" : "owned",
    truthStatus: "assumed",
    inclusion: row.inclusion || "recommended",
    time,
    dataRef: row.dataRef || null,
    sourceIds: row.sourceIds,
    derivationRuleId: "ROADMAP-WORKSTREAM-SCHEDULE-V1",
    fullLabel: [row.epic, row.functionLabel || row.name || row.feature, row.subfunctionLabel || row.detailLabel || row.detail || row.label]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" · ") || row.label,
  });
}

function roadmapWorkstreamTime(row, index, scale) {
  const text = [row.epic, row.functionLabel, row.name, row.feature, row.subfunctionLabel, row.detailLabel, row.detail, row.label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const explicitTime = roadmapWorkstreamExplicitTime(row.deadline || row.phase, scale);
  if (explicitTime) return explicitTime;
  const scheduleIndex = Number.isInteger(row.scheduleIndex) ? row.scheduleIndex : index;
  const scheduleCount = Math.max(1, Number(row.scheduleCount) || 1);
  const span = roadmapWorkstreamSpan(text, scheduleIndex, scheduleCount);
  const total = scale.end - scale.start + 1;
  const requestedUnits = roadmapWorkstreamEffortUnits(row.deadline || row.phase, scale.unit);
  const requestedDuration = requestedUnits === null ? null : Math.max(1, Math.min(total, requestedUnits));
  const preferredStart = Math.min(scale.end, scale.start + Math.floor(total * span[0]));
  // Late-stage rows (QA, UAT, release) shift left when their stated effort
  // would otherwise be clipped by the end of the brief window.
  const start = requestedDuration === null
    ? preferredStart
    : Math.max(scale.start, Math.min(preferredStart, scale.end - requestedDuration + 1));
  const end = requestedDuration === null
    ? Math.max(start, Math.min(scale.end, scale.start + Math.ceil(total * span[1]) - 1))
    : start + requestedDuration - 1;
  return { unit: scale.unit, start, end, derived: true };
}

function roadmapWorkstreamExplicitTime(value, scale) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[–—]/gu, "-");
  if (!text) return null;

  const unitPattern = {
    month: "months?|mos?|month|mo|месяц(?:ы|а|ев)?|oy",
    week: "weeks?|wks?|week|wk|нед(?:еля|ели|ель|ели|елях|елю|еле)?|hafta",
  };
  let sourceUnit = null;
  let start = null;
  let end = null;

  for (const [unit, pattern] of Object.entries(unitPattern)) {
    const prefix = text.match(new RegExp(`(?:${pattern})\\s*(\\d+)(?:\\s*-\\s*(?:${pattern})?\\s*(\\d+))?`, "iu"));
    const postfixRange = text.match(new RegExp(`(\\d+)\\s*-\\s*(\\d+)\\s*(?:${pattern})`, "iu"));
    const compact = text.match(new RegExp(`\\b${unit === "month" ? "m" : "w"}\\s*(\\d+)(?:\\s*-\\s*(?:${unit === "month" ? "m" : "w"}\\s*)?(\\d+))?\\b`, "iu"));
    const ordinal = text.match(new RegExp(`(\\d+)\\s*-(?:й|я|е|го|ю|ой)\\s*(?:${pattern})`, "iu"));
    const localizedCompact = unit === "month" ? text.match(/\b(\d+)\s*-\s*oy\b/iu) : null;
    const match = prefix || postfixRange || compact || ordinal || localizedCompact;
    if (!match) continue;
    sourceUnit = unit;
    start = Number(match[1]);
    end = Number(match[2] || match[1]);
    break;
  }
  if (!sourceUnit || !Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return null;

  let scaledStart = start;
  let scaledEnd = end;
  if (sourceUnit === "month" && scale.unit === "week") {
    scaledStart = ((start - 1) * 4) + 1;
    scaledEnd = end * 4;
  } else if (sourceUnit === "week" && scale.unit === "month") {
    scaledStart = Math.ceil(start / 4);
    scaledEnd = Math.ceil(end / 4);
  }
  if (scaledEnd < scale.start || scaledStart > scale.end) return null;
  return {
    unit: scale.unit,
    start: Math.max(scale.start, scaledStart),
    end: Math.min(scale.end, scaledEnd),
    derived: sourceUnit !== scale.unit,
  };
}

function roadmapWorkstreamEffortUnits(value, scaleUnit) {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(weeks?|wks?|wk|нед(?:ел\p{L}*)?\.?|hafta|months?|mos?|mo|месяц\p{L}*|oy)/iu);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const sourceUnit = /^(?:month|mo|месяц|oy)/iu.test(match[2]) ? "month" : "week";
  if (sourceUnit === scaleUnit) return Math.ceil(amount);
  return scaleUnit === "week" ? Math.ceil(amount * 4) : Math.max(1, Math.ceil(amount / 4));
}

function roadmapWorkstreamSpan(text, index, count) {
  const progress = count <= 1 ? .5 : index / (count - 1);
  if (/(?:discovery|research|analysis|requirements?|scope|backlog|исследован|анализ|требован|состав|tahlil|talab)/iu.test(text)) return [0, .25];
  if (/(?:\bux\b|\bui\b|design|prototype|wireframe|дизайн|прототип|интерфейс|dizayn)/iu.test(text)) return [0, .5];
  if (/(?:architect|environment|infrastructure|database|архитект|сред[аы]|инфраструктур|баз[аы]\s+данн|arxitektur|muhit)/iu.test(text)) return [0, .25];
  if (/(?:integration|api|webhook|callback|notification|report|analytics|admin|operation|интеграц|уведом|отч[её]т|аналит|админ|операц|integrats|bildirish|hisobot|boshqaruv)/iu.test(text)) {
    const start = .25 + (.25 * progress);
    return [start, Math.min(.85, start + .5)];
  }
  if (/(?:\bqa\b|test|security|stabili|regression|bug|тест|безопас|стабилиз|регресс|исправлен|sinov|xavfsiz|mustahkam)/iu.test(text)) {
    const start = .5 + (.15 * progress);
    return [start, .9375];
  }
  if (/(?:\buat\b|launch|release|deploy|production|handover|training|при[её]м|запуск|релиз|передач|обуч|ishga\s+tush|topshirish)/iu.test(text)) {
    const start = .72 + (.16 * progress);
    return [start, 1];
  }
  // Core product functions are implemented in deterministic waves instead
  // of all starting in the same calendar cell.
  const start = .1 + (.45 * progress);
  return [start, Math.min(.85, start + .5)];
}

function buildMilestoneRoadmapSpec({ requestId, phases, converted, dependencies, scale, pageNumber = 18, segmentIndex = 1, segmentCount = 1 }) {
  const nodes = phases.map((phase, index) => nodeFromEntity(`ROADMAP-${safeId(phase.id || index + 1)}`, entityLabel(phase), "milestone", phase, {
    semanticRole: phase.inclusion === "deferred" ? "deferred" : "owned",
    inclusion: phase.inclusion,
    time: converted[index].time && converted[index].time.start === converted[index].time.end ? converted[index].time : null,
    dataRef: `/roadmap/phases/${index}`,
  }));
  const edges = dependencies.length
    ? dependencies.map((dependency, index) => dependencyEdge(dependency, index, phases))
    : nodes.slice(1).map((row, index) => semanticEdge(`ROADMAP-ORDER-${index + 1}`, nodes[index].id, row.id, "sequence", {
        semanticRole: "neutral",
        truthStatus: "inferred",
        sourceIds: unionSources([phases[index], phases[index + 1]]),
        derivationRuleId: "ROADMAP-ORDER-V1",
        label: "ordered milestone",
      }));
  return baseSpec(requestId, pageNumber, {
    kind: "gantt",
    variant: "milestone",
    intent: "schedule",
    dataState: "mixed",
    layout: { engine: "milestone_timeline", orientation: "horizontal" },
    timeScale: scale,
    nodes,
    edges,
    segmentIndex,
    segmentCount,
    warnings: ["Milestones show order only; their visual spacing does not imply duration."],
  });
}

function buildPendingRoadmapSpec(requestId, reason, phases = [], { pageNumber = 18, segmentIndex = 1, segmentCount = 1 } = {}) {
  const known = phases.slice(0, 4).map((row) => entityLabel(row)).filter(Boolean);
  const nodes = [
    semanticNode("ROADMAP-Q-TIMING", "Roadmap pending: confirm phase dates or periods", "question", { truthStatus: "unknown", inclusion: "unknown" }),
    semanticNode("ROADMAP-Q-GATES", "Confirm acceptance gates and accountable outcomes", "question", { truthStatus: "unknown", inclusion: "unknown" }),
    semanticNode("ROADMAP-Q-DEPENDENCIES", "Confirm dependencies and allowed overlaps", "question", { truthStatus: "unknown", inclusion: "unknown" }),
    ...(known.length ? [semanticNode("ROADMAP-KNOWN-PHASES", `Known ordered phases: ${known.join(", ")}`, "annotation", { truthStatus: "unknown", inclusion: "unknown" })] : []),
  ];
  return baseSpec(requestId, pageNumber, {
    kind: "gantt",
    variant: "pending",
    intent: "schedule",
    dataState: "pending",
    layout: { engine: "questions", orientation: "horizontal" },
    timeScale: null,
    nodes,
    edges: [],
    segmentIndex,
    segmentCount,
    warnings: [reason],
  });
}

function baseSpec(requestId, pageNumber, fields) {
  return {
    schemaVersion: "1.0",
    visualizationSpecId: `VSPEC-P${String(pageNumber).padStart(2, "0")}`,
    requestId,
    pageNumber,
    timeScale: null,
    groups: [],
    aggregationMapping: [],
    degradation: null,
    warnings: [],
    ...fields,
  };
}

function semanticNode(id, label, type, options = {}) {
  const truthStatus = normalizeTruth(options.truthStatus);
  const sourceIds = unique(array(options.sourceIds).map(String).filter(Boolean));
  const fullLabel = cleanText(options.fullLabel || label || id, 320);
  return {
    id: String(id),
    label: cleanText(label || id, 80),
    fullLabel,
    type,
    semanticRole: options.semanticRole || "neutral",
    truthStatus,
    inclusion: normalizeInclusion(options.inclusion),
    groupId: options.groupId || null,
    lane: options.lane || null,
    time: options.time || null,
    dataRef: options.dataRef || null,
    metric: options.metric || null,
    claimNature: options.claimNature || null,
    sourceIds,
    derivationRuleId: options.derivationRuleId || (FACTUAL_TRUTH.has(truthStatus) || truthStatus === "unknown" ? null : "KP-DETERMINISTIC-V1"),
  };
}

function nodeFromEntity(id, label, type, entity = {}, overrides = {}) {
  return semanticNode(id, label, type, {
    truthStatus: entity.truthStatus || overrides.truthStatus,
    inclusion: entity.inclusion || overrides.inclusion,
    sourceIds: entity.sourceIds || overrides.sourceIds,
    derivationRuleId: entity.derivationRuleId || overrides.derivationRuleId,
    fullLabel: entityLabel(entity) || label,
    ...overrides,
  });
}

function semanticEdge(id, from, to, type, options = {}) {
  const truthStatus = normalizeTruth(options.truthStatus);
  return {
    id: String(id),
    from: String(from),
    to: String(to),
    type,
    direction: options.direction || "forward",
    label: options.label ? cleanText(options.label, 100) : null,
    semanticRole: options.semanticRole || "neutral",
    truthStatus,
    sourceIds: unique(array(options.sourceIds).map(String).filter(Boolean)),
    derivationRuleId: options.derivationRuleId || (FACTUAL_TRUTH.has(truthStatus) || truthStatus === "unknown" ? null : "KP-DETERMINISTIC-V1"),
    dataRef: options.dataRef || null,
    dependency: options.dependency || null,
  };
}

function semanticGroup(id, label, type, semanticRole, nodeIds, entities = [], fallbackRule = "KP-GROUP-V1") {
  const truthStatus = entities.length ? derivedTruth(entities) : "recommended";
  const sourceIds = unionSources(entities);
  return {
    id,
    label: cleanText(label, 100),
    type,
    semanticRole,
    nodeIds: unique(nodeIds),
    truthStatus,
    sourceIds,
    derivationRuleId: FACTUAL_TRUTH.has(truthStatus) && sourceIds.length ? null : fallbackRule,
  };
}

function marketNode(id, prefix, metric, semanticRole) {
  const context = [metric.currency, formatAmount(metric.value, metric.currency), metric.geography, metric.period].filter(Boolean).join(" · ");
  const label = `${prefix} · ${context}`;
  return semanticNode(id, label, "market_level", {
    semanticRole,
    truthStatus: metric.truthStatus,
    inclusion: "in_scope",
    sourceIds: metric.sourceIds,
    derivationRuleId: metric.derivationRuleId,
    claimNature: metric.claimNature || null,
    metric: {
      value: metric.value,
      currency: metric.currency,
      period: metric.period,
      geography: metric.geography,
      shareOfParent: metric.shareOfParent ?? null,
    },
    fullLabel: `${prefix}: ${metric.label || "Market level"}; ${context}`,
  });
}

function normalizedMarketMetric(value, market) {
  if (!value || typeof value !== "object" || !Number.isFinite(Number(value.value)) || Number(value.value) <= 0) return null;
  return {
    ...value,
    value: Number(value.value),
    label: cleanText(value.label || value.scenarioLabel || "Market level", 80),
    currency: value.currency || market.currency || null,
    period: value.period || market.period || null,
    geography: value.geography || market.geography || null,
    truthStatus: normalizeTruth(value.truthStatus),
    sourceIds: unique(array(value.sourceIds).map(String).filter(Boolean)),
    derivationRuleId: value.derivationRuleId || null,
    shareOfParent: Number.isFinite(Number(value.shareOfParent)) && Number(value.shareOfParent) > 0 && Number(value.shareOfParent) <= 1
      ? Number(value.shareOfParent)
      : null,
  };
}

function marketContext(metrics) {
  const fields = ["currency", "period", "geography"];
  const missing = fields.filter((field) => !metrics.length || metrics.some((metric) => !metric[field]));
  const conflicts = fields.filter((field) => new Set(metrics.map((metric) => metric[field]).filter(Boolean)).size > 1);
  return { complete: metrics.length > 0 && !missing.length && !conflicts.length, missing: [...missing, ...conflicts.map((field) => `consistent ${field}`)] };
}

function marketMetricHasSource(metric) {
  return !FACTUAL_TRUTH.has(metric.truthStatus) || metric.sourceIds.length > 0 || Boolean(metric.derivationRuleId);
}

function hasObservedFactualMarketMetric(metrics, sources) {
  const sourceRegistry = new Map(array(sources)
    .map((source) => typeof source === "string" ? [source, { id: source }] : [source?.id, source])
    .filter(([id]) => Boolean(id))
    .map(([id, source]) => [String(id), source]));
  return metrics.filter(Boolean).some((metric) => {
    if (String(metric.claimNature || "").trim().toLowerCase() !== "observed" || !FACTUAL_TRUTH.has(metric.truthStatus)) return false;
    return array(metric.sourceIds).some((sourceId) => {
      const source = sourceRegistry.get(String(sourceId));
      if (!source) return false;
      const status = String(source.status || "").trim().toLowerCase();
      return !/^(?:failed|error|blocked|unreadable|empty|missing|unavailable)(?:\b|:)/u.test(status);
    });
  });
}

function buildOwnershipInputEvents(semanticModel, owned) {
  const events = array(semanticModel?.events).filter((row) => ["start", "intermediate", "message"].includes(row.type)).slice(0, 4);
  if (events.length) return events;
  return [{ id: "PRODUCT-REQUEST", label: "Product request / event", type: "event", truthStatus: "recommended", sourceIds: unionSources(owned), derivationRuleId: "OWNERSHIP-INPUT-EVENT-V1" }];
}

function buildProcessEntityLookup(semanticModel) {
  const lookup = new Map();
  for (const collection of ["tasks", "events", "states", "decisions"]) {
    for (const [index, entity] of array(semanticModel?.[collection]).entries()) lookup.set(`${collection}/${entity.id}`, { collection, entity, index });
  }
  return lookup;
}

function processVisualType(collection, entity) {
  if (collection === "tasks") return "task";
  if (collection === "decisions") return "gateway";
  if (collection === "events") return entity.type === "start" ? "start_event" : entity.type === "end" ? "end_event" : "event";
  if (collection === "states") return entity.type === "initial" ? "start_event" : entity.type === "terminal" ? "end_event" : "task";
  return "task";
}

function processEdgeType(type) {
  if (type === "message") return "message";
  if (["retry", "exception", "failure"].includes(type)) return "exception";
  return "sequence";
}

function processRelationLabel(type) {
  return ({ yes: "Yes", no: "No", success: "Success", failure: "Failure", retry: "Retry", exception: "Exception" })[type] || null;
}

function assignDeterministicProcessLanes(nodes, edges) {
  const laneOwnedNodes = nodes.filter(isLaneOwnedProcessNode);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacentLane = (node, direction) => {
    const adjacentIds = direction === "downstream"
      ? edges.filter((edge) => edge.from === node.id).map((edge) => edge.to)
      : edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    const laneIds = unique(adjacentIds.map((id) => byId.get(id)?.lane).filter(Boolean));
    return laneIds.length === 1 ? laneIds[0] : null;
  };
  let changed = true;
  for (let pass = 0; pass < laneOwnedNodes.length && changed; pass += 1) {
    changed = false;
    for (const node of laneOwnedNodes.filter((row) => !row.lane)) {
      let laneId = null;
      if (node.type === "start_event") laneId = adjacentLane(node, "downstream");
      else if (["end_event", "gateway"].includes(node.type)) laneId = adjacentLane(node, "upstream");
      else laneId = adjacentLane(node, "upstream") || adjacentLane(node, "downstream");
      if (!laneId) continue;
      node.lane = laneId;
      node.groupId = laneId;
      changed = true;
    }
  }
  return laneOwnedNodes.every((node) => Boolean(node.lane && node.groupId === node.lane));
}

function isLaneOwnedProcessNode(node) {
  return !["annotation", "note"].includes(node.type);
}

function isTrustworthyProcessSpec(spec) {
  const starts = spec.nodes.filter((row) => row.type === "start_event");
  const ends = spec.nodes.filter((row) => row.type === "end_event");
  if (starts.length !== 1 || !ends.length) return false;
  if (spec.nodes.some((row) => isLaneOwnedProcessNode(row) && (!row.lane || row.groupId !== row.lane))) return false;
  const laneGroups = spec.groups.filter((row) => row.type === "lane");
  if (!laneGroups.length || laneGroups.length !== spec.groups.length) return false;
  if (new Set(laneGroups.map((row) => normalizeLabelKey(row.label))).size !== laneGroups.length) return false;
  for (const node of spec.nodes.filter(isLaneOwnedProcessNode)) {
    if (laneGroups.filter((group) => group.id === node.lane && group.nodeIds.includes(node.id)).length !== 1) return false;
  }
  const reachable = directedReachable(spec, starts[0].id, { includeDirectionNone: false });
  if (!ends.some((row) => reachable.has(row.id))) return false;
  const happyReachable = directedReachable({ ...spec, edges: spec.edges.filter((edge) => edge.type !== "exception") }, starts[0].id, { includeDirectionNone: false });
  if (!ends.some((row) => happyReachable.has(row.id))) return false;
  for (const gateway of spec.nodes.filter((row) => row.type === "gateway")) {
    const outgoing = spec.edges.filter((row) => row.from === gateway.id);
    if (outgoing.length < 2 || outgoing.some((row) => !row.label) || new Set(outgoing.map((row) => normalizeLabelKey(row.label))).size !== outgoing.length) return false;
  }
  for (const edge of spec.edges.filter((row) => row.type === "exception")) {
    const target = spec.nodes.find((row) => row.id === edge.to);
    const targetGroup = laneGroups.find((row) => row.id === target?.lane);
    if (!target || target.semanticRole === "partner" || targetGroup?.semanticRole === "partner") return false;
    const targetReachable = directedReachable(spec, edge.to, { includeDirectionNone: false });
    if (!ends.some((row) => targetReachable.has(row.id)) && !targetReachable.has(edge.from)) return false;
  }
  return true;
}

function architectureNodeType(kind) {
  return kind === "external" ? "external_system" : kind;
}

function architectureRelationRole(relation, components) {
  const endpoint = components.find((row) => (row.id === relation.from || row.id === relation.to) && (row.kind === "external" || row.semanticRole === "partner"));
  return endpoint?.kind === "external" || endpoint?.semanticRole === "partner" ? "partner" : "owned";
}

function architectureRelationLabel(type) {
  return ({ request: "request", callback: "callback", message: "message", data_flow: "data flow", dependency: "dependency", reads_writes: "reads / writes" })[type] || type;
}

function buildArchitectureGroups(architecture, nodes, components) {
  const groups = [];
  const assigned = new Set();
  for (const boundary of array(architecture.boundaries).filter((row) => ["trusted_product", "external_partner"].includes(row.type))) {
    const nodeIds = array(boundary.componentIds).map((id) => `ARCH-${safeId(id)}`).filter((id) => nodes.some((row) => row.id === id));
    if (!nodeIds.length) continue;
    nodeIds.forEach((id) => assigned.add(id));
    groups.push(semanticGroup(`ARCH-GROUP-${safeId(boundary.id)}`, boundary.label || (boundary.type === "trusted_product" ? "Trusted product boundary" : "External partner boundary"), "boundary", boundary.type === "trusted_product" ? "owned" : "partner", nodeIds, [boundary], "ARCHITECTURE-BOUNDARY-V1"));
  }
  const ownedIds = nodes.filter((row) => !assigned.has(row.id) && row.semanticRole !== "partner" && row.type !== "external_system").map((row) => row.id);
  if (ownedIds.length) groups.push(semanticGroup("ARCH-GROUP-TRUSTED", "Trusted product boundary", "boundary", "owned", ownedIds, components.filter((row) => ownedIds.includes(`ARCH-${safeId(row.id)}`)), "ARCHITECTURE-BOUNDARY-V1"));
  const externalIds = nodes.filter((row) => !assigned.has(row.id) && (row.semanticRole === "partner" || row.type === "external_system")).map((row) => row.id);
  if (externalIds.length) groups.push(semanticGroup("ARCH-GROUP-EXTERNAL", "External partners", "boundary", "partner", externalIds, components.filter((row) => externalIds.includes(`ARCH-${safeId(row.id)}`)), "ARCHITECTURE-BOUNDARY-V1"));
  const groupByNode = new Map(groups.flatMap((group) => group.nodeIds.map((id) => [id, group.id])));
  for (const node of nodes) node.groupId = groupByNode.get(node.id) || node.groupId;
  return groups;
}

function normalizedTimeScale(value) {
  const start = Number(value?.start);
  const end = Number(value?.end);
  if (!["week", "month"].includes(value?.unit) || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  return { unit: value.unit, start, end };
}

function convertTimeToScale(value, scale) {
  if (!value) return null;
  const start = Number(value.start);
  const end = Number(value.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return { invalid: true };
  if (value.unit === scale.unit) return { unit: scale.unit, start, end, derived: false };
  if (value.unit === "month" && scale.unit === "week") return { unit: "week", start: ((start - 1) * 4) + 1, end: end * 4, derived: true };
  if (value.unit === "week" && scale.unit === "month" && (start - 1) % 4 === 0 && end % 4 === 0) return { unit: "month", start: ((start - 1) / 4) + 1, end: end / 4, derived: true };
  return { invalid: true };
}

function dependencyEdge(dependency, index, phases) {
  const supporting = phases.filter((row) => row.id === dependency.fromPhaseId || row.id === dependency.toPhaseId);
  return semanticEdge(`ROADMAP-DEP-${index + 1}`, `ROADMAP-${safeId(dependency.fromPhaseId)}`, `ROADMAP-${safeId(dependency.toPhaseId)}`, "dependency", {
    semanticRole: "neutral",
    truthStatus: derivedTruth(supporting),
    sourceIds: unionSources(supporting),
    derivationRuleId: supporting.every((row) => FACTUAL_TRUTH.has(normalizeTruth(row.truthStatus))) ? null : "ROADMAP-DEPENDENCY-V1",
    label: dependency.type.replaceAll("_", " "),
    dependency: { type: dependency.type, lag: Number(dependency.lag || 0), allowOverlap: Boolean(dependency.allowOverlap) },
  });
}

function isSyntheticDefaultRoadmap(phases, roadmap) {
  if (phases.length !== 1 || array(roadmap.dependencies).length) return false;
  const phase = phases[0];
  return phase.id === "PHASE-1" && phase.label === "Delivery" && phase.time?.unit === "week" && phase.time?.start === 1 && phase.time?.end === Number(roadmap.durationWeeks || 0) && !phase.derivationRuleId;
}

function aggregationRow(id, aggregateNodeId, sourceEntityIds, reason, displayLabel) {
  return { id, aggregateNodeId, sourceEntityIds: unique(sourceEntityIds.map(String)), reason, displayLabel: cleanText(displayLabel, 100) };
}

function compactQuestionRows(rows, maxRows, combinedId, combinedLabel) {
  const uniqueRows = [];
  const seen = new Set();
  for (const row of rows) {
    const key = normalizeLabelKey(row.label);
    if (!seen.has(key)) uniqueRows.push(row);
    seen.add(key);
  }
  if (uniqueRows.length <= maxRows) return uniqueRows;
  return [...uniqueRows.slice(0, maxRows - 1), { id: combinedId, label: `${combinedLabel} (+${uniqueRows.length - maxRows + 1})`, target: "FORMULA-TAM" }];
}

function directedReachable(spec, rootId, { includeDirectionNone = false } = {}) {
  const reachable = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of array(spec.edges)) {
      if (!includeDirectionNone && edge.direction === "none") continue;
      if (reachable.has(edge.from) && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        changed = true;
      }
      if (edge.direction === "both" && reachable.has(edge.to) && !reachable.has(edge.from)) {
        reachable.add(edge.from);
        changed = true;
      }
    }
  }
  return reachable;
}

function derivedTruth(rows) {
  const values = rows.map((row) => normalizeTruth(row?.truthStatus));
  if (!values.length) return "recommended";
  for (const status of ["unknown", "assumed", "inferred", "recommended", "single_source", "verified", "explicit"]) if (values.includes(status)) return status;
  return "recommended";
}

function unionSources(rows) {
  return unique(rows.flatMap((row) => array(row?.sourceIds).map(String)).filter(Boolean));
}

function normalizeTruth(value) {
  return TRUTH_STATUSES.has(value) ? value : "unknown";
}

function normalizeInclusion(value) {
  return INCLUSIONS.has(value) ? value : "unknown";
}

function entityLabel(entity) {
  return cleanText(entity?.label || entity?.feature || entity?.name || entity?.role || entity?.question || entity?.id || "To confirm", 320);
}

function formatAmount(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "To confirm";
  const absolute = Math.abs(number);
  const compact = absolute >= 1e9 ? `${trimNumber(number / 1e9)}B` : absolute >= 1e6 ? `${trimNumber(number / 1e6)}M` : absolute >= 1e3 ? `${trimNumber(number / 1e3)}K` : trimNumber(number);
  return `${currency || ""} ${compact}`.trim();
}

function trimNumber(value) {
  return Number(value.toFixed(2)).toString();
}

function formatPercent(value) {
  return `${trimNumber(Number(value) * 100)}%`;
}

function uniqueVisibleLabel(label, used, qualifier) {
  let candidate = cleanText(label, 80);
  if (!used.has(normalizeLabelKey(candidate))) {
    used.add(normalizeLabelKey(candidate));
    return candidate;
  }
  candidate = cleanText(`${label} · ${qualifier}`, 80);
  let ordinal = 2;
  while (used.has(normalizeLabelKey(candidate))) candidate = cleanText(`${label} · ${qualifier} ${ordinal++}`, 80);
  used.add(normalizeLabelKey(candidate));
  return candidate;
}

function cleanText(value, maxLength) {
  const normalized = String(value ?? "").normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  const points = [...normalized];
  if (points.length <= maxLength) return normalized || "To confirm";
  return `${points.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function safeId(value) {
  return String(value ?? "UNKNOWN").normalize("NFC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "UNKNOWN";
}

function normalizeLabelKey(value) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function uniqueEntities(rows) {
  const seen = new Set();
  return rows.filter((row, index) => {
    const key = String(row?.id || `${normalizeLabelKey(entityLabel(row))}:${index}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values) {
  return [...new Set(values)];
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
