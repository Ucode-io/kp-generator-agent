import { validateKpContract } from "./kp_reference_contracts.mjs";
import { ARCHITECTURE_LAYER_ORDER, architectureLayerIdForNode } from "./kp_architecture_layers.mjs";
import { PRODUCT_MAP_PAGE_LIMITS } from "./kp_product_map_model.mjs";
import {
  buildPrimaryFlowSpec,
  buildRoadmapWorkstreamSegments,
  primaryFlowProcesses,
  ROADMAP_WORKSTREAM_PAGE_LIMIT,
} from "./kp_visualization_planner.mjs";

const GRAPH_KINDS = new Set(["ownership_boundary", "hub_spoke", "bpmn", "architecture"]);
const FACTUAL_TRUTH = new Set(["explicit", "verified", "single_source"]);
const DERIVED_TRUTH = new Set(["recommended", "inferred", "assumed"]);
const PENDING_VARIANTS = new Set(["pending", "questions"]);
const LIMITS = Object.freeze({
  nested_market: { nodes: 6, edges: 8 },
  ownership_boundary: { nodes: 19, edges: 24 },
  // The expanded product-map canvas carries up to 16 function/detail rows
  // plus their root and domain nodes without dropping below 11 px type.
  hub_spoke: { nodes: PRODUCT_MAP_PAGE_LIMITS.maxVisibleNodes, edges: PRODUCT_MAP_PAGE_LIMITS.maxVisibleNodes - 1 },
  // A full-width BPMN page safely carries one detailed subprocess with up to
  // sixteen semantic nodes. Longer journeys continue on a second page.
  bpmn: { nodes: 16, edges: 20 },
  architecture: { nodes: 20, edges: 28 },
  // A detailed roadmap page carries up to ten macro phase bands plus fourteen
  // terminal product workstreams. Continuation pages repeat the phase bands
  // while advancing through the canonical product inventory.
  gantt: { nodes: 24, edges: 16 },
});
const EXPECTED_PLAN_KIND = Object.freeze({
  market_sizing: "nested_market",
  launch_boundary: "ownership_boundary",
  product_map: "hub_spoke",
  primary_flow: "bpmn",
  architecture: "architecture",
  roadmap: "gantt",
});

export async function validateVisualizationSpecs({ specs = [], proposalModel = {}, semanticModel = {}, presentationPlan = {}, sourceRegistry = null } = {}) {
  const findings = [];
  const specIds = new Set();
  const inheritedSources = array(semanticModel?.sources).length ? semanticModel.sources : proposalModel?.sources;
  const sources = normalizeSourceRegistry(sourceRegistry ?? inheritedSources);
  for (const spec of specs) {
    const schema = await validateKpContract("visualizationSpec", spec, { throwOnError: false });
    if (!schema.ok) findings.push(...schema.errors.map((error) => finding("CONTRACT_VISUALIZATION_SPEC_INVALID", "ERROR", { visualizationSpecId: spec?.visualizationSpecId, ...error })));
    if (specIds.has(spec?.visualizationSpecId)) findings.push(finding("SEM_VISUALIZATION_ID_DUPLICATE", "BLOCKER", { visualizationSpecId: spec?.visualizationSpecId }));
    specIds.add(spec?.visualizationSpecId);
    findings.push(...validateGraphIntegrity(spec || {}, { sourceRegistry: sources }));
    findings.push(...validatePageSpecificSemantics(spec || {}, { proposalModel, semanticModel, presentationPlan, sourceRegistry: sources }));
  }
  const expectedIds = new Set((presentationPlan.pages || []).filter((page) => page.visualizationSpecId).map((page) => page.visualizationSpecId));
  for (const id of expectedIds) {
    if (!specs.some((spec) => spec.visualizationSpecId === id)) findings.push(finding("SEM_REQUIRED_SPEC_MISSING", "BLOCKER", { visualizationSpecId: id }));
  }
  for (const spec of specs) {
    if (expectedIds.size && spec.pageNumber && !expectedIds.has(spec.visualizationSpecId)) findings.push(finding("SEM_UNPLANNED_SPEC", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId }));
  }
  findings.push(...validatePrimaryFlowSegmentCoverage(specs, semanticModel, presentationPlan));
  findings.push(...validateRoadmapInventoryCoverage(specs, semanticModel, presentationPlan));
  return { ok: findings.length === 0, findings };
}

export function validateGraphIntegrity(spec, { sourceRegistry = null } = {}) {
  const findings = [];
  const nodes = array(spec.nodes);
  const edges = array(spec.edges);
  const groups = array(spec.groups);
  const nodeIds = idSet(nodes);
  const edgeIds = idSet(edges);
  const groupIds = idSet(groups);
  if (nodeIds.duplicates.length) findings.push(finding("SEM_NODE_ID_DUPLICATE", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, ids: nodeIds.duplicates }));
  if (edgeIds.duplicates.length) findings.push(finding("SEM_EDGE_ID_DUPLICATE", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, ids: edgeIds.duplicates }));
  if (groupIds.duplicates.length) findings.push(finding("SEM_GROUP_REFERENCE_INVALID", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, ids: groupIds.duplicates, reason: "duplicate_group_id" }));

  for (const edge of edges) {
    if (!nodeIds.set.has(edge.from) || !nodeIds.set.has(edge.to)) findings.push(finding("SEM_EDGE_ENDPOINT_UNKNOWN", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, edgeId: edge.id }));
    if (edge.from === edge.to && !["exception"].includes(edge.type)) findings.push(finding("SEM_SELF_LOOP_FORBIDDEN", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, edgeId: edge.id }));
    findings.push(...validateProvenance(edge, { sourceRegistry, visualizationSpecId: spec.visualizationSpecId, elementId: edge.id, elementKind: "edge" }));
  }
  const limits = LIMITS[spec.kind];
  if (limits && nodes.length > limits.nodes) findings.push(finding("SEM_VISIBLE_LIMIT_EXCEEDED", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, elementKind: "node", actual: nodes.length, limit: limits.nodes }));
  if (limits && edges.length > limits.edges) findings.push(finding("SEM_VISIBLE_LIMIT_EXCEEDED", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, elementKind: "edge", actual: edges.length, limit: limits.edges }));
  if (GRAPH_KINDS.has(spec.kind) && !PENDING_VARIANTS.has(spec.variant) && !edges.length) findings.push(finding("SEM_ZERO_EDGE_DIAGRAM", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId }));

  for (const [index, node] of nodes.entries()) {
    if (!String(node.label || "").trim()) findings.push(finding("SEM_NODE_LABEL_EMPTY", PENDING_VARIANTS.has(spec.variant) ? "ERROR" : "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, nodeId: node.id }));
    if ([...String(node.label || "")].length > 80 || [...String(node.fullLabel || "")].length > 320) findings.push(finding("SEM_LABEL_TOO_LONG", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, nodeId: node.id }));
    if (/https?:\/\/|\/Users\/|[A-Za-z]:\\/iu.test(`${node.label || ""} ${node.fullLabel || ""}`)) findings.push(finding("SEM_PRIVATE_OR_REMOTE_LABEL", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, nodeIndex: index }));
    findings.push(...validateProvenance(node, { sourceRegistry, visualizationSpecId: spec.visualizationSpecId, elementId: node.id, elementKind: "node" }));
  }

  for (const group of groups) {
    findings.push(...validateProvenance(group, { sourceRegistry, visualizationSpecId: spec.visualizationSpecId, elementId: group.id, elementKind: "group" }));
    for (const nodeId of array(group.nodeIds)) {
      const node = nodes.find((row) => row.id === nodeId);
      if (!node || node.groupId !== group.id) findings.push(finding("SEM_GROUP_REFERENCE_INVALID", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, groupId: group.id, nodeId, reason: !node ? "unknown_node" : "membership_mismatch" }));
    }
  }
  for (const node of nodes.filter((row) => row.groupId)) {
    const group = groups.find((row) => row.id === node.groupId);
    if (!group || !array(group.nodeIds).includes(node.id)) findings.push(finding("SEM_GROUP_REFERENCE_INVALID", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, groupId: node.groupId, nodeId: node.id, reason: "reverse_membership_mismatch" }));
  }

  if (GRAPH_KINDS.has(spec.kind) && !PENDING_VARIANTS.has(spec.variant)) {
    for (const orphan of orphanNodes(spec)) findings.push(finding("SEM_NODE_ORPHAN", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, nodeId: orphan.id }));
  }
  findings.push(...validateAggregation(spec));
  return findings;
}

export function validatePageSpecificSemantics(spec, inputs = {}) {
  const findings = [];
  const plannedPage = (inputs.presentationPlan?.pages || []).find((page) => Number(page.pageNumber) === Number(spec.pageNumber));
  const expectedKind = EXPECTED_PLAN_KIND[plannedPage?.kind];
  if (expectedKind && spec.kind !== expectedKind) findings.push(finding("VIZ_GENERIC_GRID_FORBIDDEN", "BLOCKER", { page: spec.pageNumber, expectedKind, actualKind: spec.kind }));
  if (spec.kind === "nested_market") findings.push(...validateNestedMarket(spec, inputs.sourceRegistry instanceof Map ? inputs.sourceRegistry : normalizeSourceRegistry(inputs.sourceRegistry)));
  if (spec.kind === "ownership_boundary") findings.push(...validateOwnershipBoundary(spec));
  if (spec.kind === "hub_spoke") findings.push(...validateProductMap(spec));
  if (spec.kind === "bpmn") findings.push(...validateBpmn(spec));
  if (spec.kind === "architecture") findings.push(...validateArchitecture(spec));
  if (spec.kind === "gantt") findings.push(...validateRoadmap(spec, inputs.semanticModel));
  return findings;
}

function validateNestedMarket(spec, sourceRegistry = null) {
  const findings = [];
  const nodes = array(spec.nodes);
  if (spec.variant === "formula_pending") {
    for (const formulaId of ["FORMULA-TAM", "FORMULA-SAM", "FORMULA-SOM"]) {
      if (!nodes.some((row) => row.id === formulaId)) findings.push(finding("SEM_MARKET_FORMULA_INCOMPLETE", "BLOCKER", { page: spec.pageNumber, nodeId: formulaId }));
    }
    if (!nodes.some((row) => row.type === "question" && row.truthStatus === "unknown" && /^To confirm:/iu.test(row.label))) findings.push(finding("SEM_MARKET_MISSING_INPUTS_UNLABELED", "BLOCKER", { page: spec.pageNumber }));
    if (nodes.some((node) => /(^|[^0-9])0([^0-9]|$)/u.test(node.label))) findings.push(finding("SEM_MARKET_NULL_RENDERED_AS_ZERO", "BLOCKER", { page: spec.pageNumber }));
    return findings;
  }
  const tam = nodes.find((row) => row.id === "MARKET-TAM");
  const sam = nodes.find((row) => row.id === "MARKET-SAM");
  const soms = nodes.filter((row) => row.id.startsWith("MARKET-SOM-"));
  if (!tam?.metric || !sam?.metric || !soms.length || soms.some((row) => !row.metric)) findings.push(finding("SEM_MARKET_LEVEL_MISSING", "BLOCKER", { page: spec.pageNumber }));
  if (!tam?.metric || !sam?.metric) return findings;
  if (![tam, sam, ...soms].some((row) => observedFactualMarketNodeHasUsableSource(row, sourceRegistry))) {
    findings.push(finding("SEM_MARKET_OBSERVED_SOURCE_MISSING", "BLOCKER", { page: spec.pageNumber }));
  }
  if (tam.metric.value < sam.metric.value || soms.some((row) => row.metric.value > sam.metric.value)) findings.push(finding("SEM_MARKET_ORDER_INVALID", "BLOCKER", { page: spec.pageNumber }));
  const contexts = [tam, sam, ...soms].map((row) => row.metric);
  for (const key of ["currency", "period", "geography"]) {
    if (new Set(contexts.map((row) => row?.[key])).size !== 1) findings.push(finding("SEM_MARKET_CONTEXT_MISMATCH", "BLOCKER", { page: spec.pageNumber, field: key }));
  }
  if (!marketShareMatches(sam.metric, tam.metric)) findings.push(finding("SEM_MARKET_SHARE_MISMATCH", "BLOCKER", { page: spec.pageNumber, nodeId: sam.id }));
  for (const som of soms) if (!marketShareMatches(som.metric, sam.metric)) findings.push(finding("SEM_MARKET_SHARE_MISMATCH", "BLOCKER", { page: spec.pageNumber, nodeId: som.id }));
  return findings;
}

function validateOwnershipBoundary(spec) {
  const findings = [];
  const nodes = array(spec.nodes);
  const edges = array(spec.edges);
  if (spec.variant === "pending") {
    if (edges.length || spec.layout?.engine !== "questions") findings.push(finding("SEM_BOUNDARY_AS_LINEAR_GRID", "BLOCKER", { page: spec.pageNumber }));
    if (nodes.filter((row) => row.type === "question").length < 3) findings.push(finding("SEM_BOUNDARY_SEMANTICS_LOST", "BLOCKER", { page: spec.pageNumber }));
    return findings;
  }
  const inputs = nodes.filter((row) => row.type === "event");
  const cores = nodes.filter((row) => row.type === "core" && row.semanticRole === "owned");
  const ownedCapabilities = nodes.filter((row) => row.type === "capability" && row.semanticRole === "owned");
  const partners = nodes.filter((row) => row.type === "external_system" && row.semanticRole === "partner");
  const deferred = nodes.filter((row) => row.type === "capability" && row.semanticRole === "deferred");
  if (inputs.length < 1 || inputs.length > 4 || cores.length !== 1) findings.push(finding("SEM_SIGNAL_WITHOUT_OWNER", "BLOCKER", { page: spec.pageNumber }));
  if (ownedCapabilities.length < 2 || ownedCapabilities.length > 5) findings.push(finding("SEM_OWNED_CAPABILITY_MINIMUM", "BLOCKER", { page: spec.pageNumber, actual: ownedCapabilities.length }));
  if (partners.length > 5 || deferred.length > 4) findings.push(finding("SEM_VISIBLE_LIMIT_EXCEEDED", "BLOCKER", { page: spec.pageNumber }));
  const roles = new Set(array(spec.groups).map((row) => row.semanticRole));
  if (!["owned", "partner", "deferred"].every((role) => roles.has(role))) findings.push(finding("SEM_BOUNDARY_SEMANTICS_LOST", "BLOCKER", { page: spec.pageNumber }));
  const core = cores[0];
  for (const input of inputs) {
    if (!edges.some((edge) => edge.from === input.id && edge.to === core?.id && ["sequence", "message"].includes(edge.type))) findings.push(finding("SEM_SIGNAL_WITHOUT_OWNER", "BLOCKER", { page: spec.pageNumber, nodeId: input.id }));
  }
  for (const partner of partners) {
    const outbound = edges.some((edge) => edge.from === core?.id && edge.to === partner.id && ["request", "message"].includes(edge.type));
    const inbound = edges.some((edge) => edge.from === partner.id && edge.to === core?.id && ["callback", "status"].includes(edge.type));
    if (!outbound || !inbound) findings.push(finding("SEM_INTEGRATION_UNCONNECTED", "BLOCKER", { page: spec.pageNumber, nodeId: partner.id }));
  }
  const primaryRoots = [...inputs.map((row) => row.id), core?.id].filter(Boolean);
  for (const root of primaryRoots) {
    const reachable = directedReachable(spec, root);
    for (const deferredNode of deferred) if (reachable.has(deferredNode.id)) findings.push(finding("SEM_DEFER_ON_PRIMARY_PATH", "BLOCKER", { page: spec.pageNumber, nodeId: deferredNode.id }));
  }
  if (edges.some((edge) => {
    const from = nodes.find((row) => row.id === edge.from);
    const to = nodes.find((row) => row.id === edge.to);
    return (from?.semanticRole === "partner" && to?.semanticRole === "deferred") || (from?.semanticRole !== "deferred" && to?.semanticRole === "deferred" && edge.direction !== "none");
  })) findings.push(finding("SEM_DEFER_ON_PRIMARY_PATH", "BLOCKER", { page: spec.pageNumber }));
  return findings;
}

function validateProductMap(spec) {
  const findings = [];
  const nodes = array(spec.nodes);
  const edges = array(spec.edges);
  if (spec.variant === "pending") {
    if (edges.length || spec.layout?.engine !== "questions" || nodes.filter((row) => row.type === "question").length < 2) findings.push(finding("SEM_MINDMAP_ROOT_MISSING", "BLOCKER", { page: spec.pageNumber }));
    return findings;
  }
  const roots = nodes.filter((node) => node.type === "core");
  if (roots.length !== 1) findings.push(finding("SEM_MINDMAP_ROOT_MISSING", "BLOCKER", { page: spec.pageNumber }));
  const root = roots[0];
  if (!root) return findings;
  const branches = edges.filter((edge) => edge.from === root.id).map((edge) => nodes.find((row) => row.id === edge.to)).filter(Boolean);
  const minimumBranches = 1;
  const allowedBranchTypes = spec.variant === "left_to_right_tree" ? ["domain"] : ["domain", "surface", "aggregate"];
  if (branches.length < minimumBranches || branches.length > PRODUCT_MAP_PAGE_LIMITS.maxBranches || branches.some((row) => !allowedBranchTypes.includes(row.type))) findings.push(finding("SEM_PRODUCT_MAP_BRANCH_MINIMUM", "BLOCKER", { page: spec.pageNumber, actual: branches.length }));
  const terminalRows = nodes.filter((node) => node.type === "subfunction").length
    + nodes.filter((node) => node.type === "capability" && !edges.some((edge) => edge.from === node.id)).length;
  if (terminalRows > PRODUCT_MAP_PAGE_LIMITS.maxTerminalRows) findings.push(finding("SEM_PRODUCT_MAP_PAGE_LIMIT", "BLOCKER", { page: spec.pageNumber, actual: terminalRows, maximum: PRODUCT_MAP_PAGE_LIMITS.maxTerminalRows }));
  if (["two_sided_tree", "left_to_right_tree", "radial"].includes(spec.variant) && edges.length !== Math.max(0, nodes.length - 1)) findings.push(finding("SEM_PRODUCT_MAP_TREE_EDGE_COUNT", "BLOCKER", { page: spec.pageNumber }));
  if (spec.variant === "left_to_right_tree" && spec.layout?.engine !== "left_to_right_tree") findings.push(finding("SEM_PRODUCT_MAP_LAYOUT_INVALID", "BLOCKER", { page: spec.pageNumber }));
  if ((spec.segmentIndex || spec.segmentCount) && (!Number.isInteger(spec.segmentIndex) || !Number.isInteger(spec.segmentCount) || spec.segmentIndex < 1 || spec.segmentIndex > spec.segmentCount)) findings.push(finding("SEM_PRODUCT_MAP_SEGMENT_INVALID", "BLOCKER", { page: spec.pageNumber }));
  if (spec.variant === "left_to_right_tree" && (array(spec.aggregationMapping).length || spec.degradation)) findings.push(finding("SEM_PRODUCT_MAP_CONTENT_HIDDEN", "BLOCKER", { page: spec.pageNumber }));
  const incomingCount = new Map(nodes.map((row) => [row.id, 0]));
  for (const edge of edges) incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
  for (const node of nodes.filter((row) => row.id !== root.id)) if (incomingCount.get(node.id) !== 1) findings.push(finding("SEM_PRODUCT_MAP_PARENT_INVALID", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
  const reachable = directedReachable(spec, root.id);
  for (const node of nodes) if (!reachable.has(node.id)) findings.push(finding("SEM_PRODUCT_MAP_DISCONNECTED", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
  const branchIds = new Set(branches.map((row) => row.id));
  for (const node of nodes.filter((row) => row.type === "capability")) {
    const parent = edges.find((edge) => edge.to === node.id)?.from;
    if (!branchIds.has(parent)) findings.push(finding("SEM_PRODUCT_MAP_PARENT_INVALID", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
  }
  const capabilityIds = new Set(nodes.filter((row) => row.type === "capability").map((row) => row.id));
  for (const node of nodes.filter((row) => row.type === "subfunction")) {
    const parent = edges.find((edge) => edge.to === node.id)?.from;
    if (!capabilityIds.has(parent)) findings.push(finding("SEM_PRODUCT_MAP_PARENT_INVALID", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
  }
  for (const node of nodes.filter((row) => row.type === "domain")) {
    const parent = edges.find((edge) => edge.to === node.id)?.from;
    if (parent !== root.id) findings.push(finding("SEM_PRODUCT_MAP_PARENT_INVALID", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
  }
  const labels = nodes.map((row) => normalizeLabel(row.label));
  if (new Set(labels).size !== labels.length) findings.push(finding("SEM_PRODUCT_MAP_LABEL_DUPLICATE", "BLOCKER", { page: spec.pageNumber }));
  return findings;
}

function validateBpmn(spec) {
  const findings = [];
  const nodes = array(spec.nodes);
  const edges = array(spec.edges);
  if (spec.variant === "questions") {
    if (edges.length || spec.layout?.engine !== "questions") findings.push(finding("SEM_BPMN_PATH_INVALID", "BLOCKER", { page: spec.pageNumber }));
    if (!nodes.some((row) => /^Process questions:/u.test(row.label)) || nodes.filter((row) => row.type === "question").length < 3) findings.push(finding("SEM_BPMN_QUESTIONS_TITLE_MISSING", "BLOCKER", { page: spec.pageNumber }));
    if (nodes.some((row) => ["start_event", "end_event", "gateway"].includes(row.type))) findings.push(finding("SEM_BPMN_FAKE_PROCESS_IN_QUESTIONS", "BLOCKER", { page: spec.pageNumber }));
    return findings;
  }
  const starts = nodes.filter((node) => node.type === "start_event");
  const ends = nodes.filter((node) => node.type === "end_event");
  const segmentIndex = Number(spec.segmentIndex || 1);
  const segmentCount = Number(spec.segmentCount || 1);
  if (!Number.isInteger(segmentIndex) || !Number.isInteger(segmentCount) || segmentIndex < 1 || segmentIndex > segmentCount) {
    findings.push(finding("SEM_BPMN_SEGMENT_COVERAGE_MISMATCH", "BLOCKER", { page: spec.pageNumber, segmentIndex, segmentCount }));
  }
  if (starts.length !== 1 || !ends.length) findings.push(finding("SEM_BPMN_PATH_INVALID", "BLOCKER", { page: spec.pageNumber, starts: starts.length, ends: ends.length }));
  const groups = array(spec.groups);
  const laneGroups = groups.filter((row) => row.type === "lane");
  if (!laneGroups.length || laneGroups.length > 6 || groups.length !== laneGroups.length) findings.push(finding("SEM_BPMN_LANE_LIMIT_EXCEEDED", "BLOCKER", { page: spec.pageNumber }));
  const normalizedLaneLabels = laneGroups.map((row) => normalizeLabel(row.label));
  if (normalizedLaneLabels.some((label) => !label) || new Set(normalizedLaneLabels).size !== normalizedLaneLabels.length) {
    findings.push(finding("SEM_BPMN_LANE_LABEL_INVALID", "BLOCKER", { page: spec.pageNumber }));
  }
  for (const node of nodes.filter((row) => !["annotation", "note"].includes(row.type))) {
    const memberships = laneGroups.filter((row) => row.id === node.lane && row.nodeIds.includes(node.id));
    if (!node.lane || node.groupId !== node.lane || memberships.length !== 1) findings.push(finding("SEM_BPMN_NODE_LANE_MISSING", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
  }
  for (const gateway of nodes.filter((node) => node.type === "gateway")) {
    const outgoing = edges.filter((edge) => edge.from === gateway.id);
    if (outgoing.length < 2 || outgoing.some((edge) => !edge.label) || new Set(outgoing.map((edge) => normalizeLabel(edge.label))).size !== outgoing.length) findings.push(finding("SEM_BPMN_DECISION_INVALID", "BLOCKER", { page: spec.pageNumber, nodeId: gateway.id }));
  }
  if (spec.variant === "linear" && nodes.some((row) => row.type === "gateway")) findings.push(finding("SEM_BPMN_DECISION_INVALID", "BLOCKER", { page: spec.pageNumber, reason: "linear_variant_has_gateway" }));
  if (starts[0]) {
    const reachable = directedReachable(spec, starts[0].id);
    if (!ends.some((row) => reachable.has(row.id))) findings.push(finding("SEM_BPMN_PATH_INVALID", "BLOCKER", { page: spec.pageNumber }));
    for (const node of nodes.filter((row) => !["annotation", "note"].includes(row.type))) if (!reachable.has(node.id)) findings.push(finding("SEM_BPMN_PATH_INVALID", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
    const happyReachable = directedReachable({ ...spec, edges: edges.filter((edge) => edge.type !== "exception") }, starts[0].id);
    if (!ends.some((row) => happyReachable.has(row.id))) findings.push(finding("SEM_BPMN_HAPPY_PATH_MISSING", "BLOCKER", { page: spec.pageNumber }));
  }
  for (const edge of edges.filter((row) => row.type === "exception")) {
    const target = nodes.find((row) => row.id === edge.to);
    const targetLane = laneGroups.find((row) => row.id === target?.lane);
    if (!target || target.semanticRole === "partner" || targetLane?.semanticRole === "partner") findings.push(finding("SEM_BPMN_EXCEPTION_OWNER_INVALID", "BLOCKER", { page: spec.pageNumber, edgeId: edge.id }));
    const targetCanFinish = ends.some((end) => directedReachable(spec, edge.to).has(end.id));
    const explicitLoop = directedReachable(spec, edge.to).has(edge.from);
    if (!targetCanFinish && !explicitLoop) findings.push(finding("SEM_BPMN_EXCEPTION_UNRESOLVED", "BLOCKER", { page: spec.pageNumber, edgeId: edge.id }));
  }
  return findings;
}

function validatePrimaryFlowSegmentCoverage(specs, semanticModel, presentationPlan) {
  const expectedProcesses = primaryFlowProcesses(semanticModel);
  if (!expectedProcesses.length) return [];
  const plannedFlowPages = array(presentationPlan?.pages)
    .filter((page) => page.kind === "primary_flow")
    .sort((left, right) => Number(left.pageNumber) - Number(right.pageNumber));
  const primaryFlowPageNumbers = new Set(plannedFlowPages.map((page) => Number(page.pageNumber)));
  const eligibleSpecs = array(specs)
    .filter((spec) => spec.kind === "bpmn" && spec.variant !== "questions" && (
      primaryFlowPageNumbers.size ? primaryFlowPageNumbers.has(Number(spec.pageNumber)) : true
    ));
  const actualSpecs = plannedFlowPages.length
    ? plannedFlowPages.map((page) => eligibleSpecs.find((spec) => spec.visualizationSpecId === page.visualizationSpecId))
    : eligibleSpecs.sort((left, right) => Number(left.segmentIndex || 1) - Number(right.segmentIndex || 1));
  const actualIndices = actualSpecs.filter(Boolean).map((spec) => Number(spec.segmentIndex || 1));
  const sequenceValid = actualSpecs.length === expectedProcesses.length
    && actualSpecs.every((spec, index) => spec
      && Number(spec.segmentIndex || 1) === index + 1
      && Number(spec.segmentCount || 1) === expectedProcesses.length
      && (!plannedFlowPages[index] || (
        Number(spec.pageNumber) === Number(plannedFlowPages[index].pageNumber)
        && Number(plannedFlowPages[index].segmentIndex || index + 1) === index + 1
        && Number(plannedFlowPages[index].segmentCount || expectedProcesses.length) === expectedProcesses.length
      )));
  const segmentMismatches = [];
  for (const [index, process] of expectedProcesses.entries()) {
    const spec = actualSpecs[index];
    if (!spec) {
      segmentMismatches.push({ segmentIndex: index + 1, reason: "missing_segment" });
      continue;
    }
    const expectedNodeRefs = array(process.nodeRefs).map((ref) => processEntityDataRef(semanticModel, ref));
    const actualNodeRefs = array(spec.nodes).map((node) => node.dataRef);
    const expectedRelationRefs = array(process.relationIds).map((id) => {
      const relationIndex = array(semanticModel?.processRelations).findIndex((row) => row.id === id);
      return relationIndex >= 0 ? `/processRelations/${relationIndex}` : null;
    });
    const actualRelationRefs = array(spec.edges).map((edge) => edge.dataRef);
    const canonical = buildPrimaryFlowSpec({
      semanticModel,
      requestId: spec.requestId || semanticModel?.requestId || "BPMN-COVERAGE",
      pageNumber: spec.pageNumber,
      segmentIndex: index + 1,
      segmentCount: expectedProcesses.length,
    });
    const expectedNodeSignatures = array(canonical.nodes).map(bpmnNodeSignature);
    const actualNodeSignatures = array(spec.nodes).map(bpmnNodeSignature);
    const expectedEdgeSignatures = array(canonical.edges).map(bpmnEdgeSignature);
    const actualEdgeSignatures = array(spec.edges).map(bpmnEdgeSignature);
    if (expectedNodeRefs.some((value) => value === null)
      || expectedRelationRefs.some((value) => value === null)
      || expectedNodeRefs.length !== actualNodeRefs.length
      || expectedRelationRefs.length !== actualRelationRefs.length
      || expectedNodeRefs.some((value, refIndex) => value !== actualNodeRefs[refIndex])
      || expectedRelationRefs.some((value, refIndex) => value !== actualRelationRefs[refIndex])
      || expectedNodeSignatures.some((value, signatureIndex) => value !== actualNodeSignatures[signatureIndex])
      || expectedEdgeSignatures.some((value, signatureIndex) => value !== actualEdgeSignatures[signatureIndex])) {
      segmentMismatches.push({
        segmentIndex: index + 1,
        expectedNodeRefs,
        actualNodeRefs,
        expectedRelationRefs,
        actualRelationRefs,
        expectedNodeSignatures,
        actualNodeSignatures,
        expectedEdgeSignatures,
        actualEdgeSignatures,
      });
    }
  }
  if (sequenceValid && !segmentMismatches.length) return [];
  return [finding("SEM_BPMN_SEGMENT_COVERAGE_MISMATCH", "BLOCKER", {
    reason: "bpmn_continuations_do_not_cover_canonical_process_segments",
    expectedSegmentCount: expectedProcesses.length,
    actualIndices,
    segmentMismatches,
  })];
}

function bpmnNodeSignature(node) {
  return JSON.stringify([node?.id, node?.label, node?.fullLabel, node?.type, node?.semanticRole, node?.groupId, node?.lane, node?.dataRef]);
}

function bpmnEdgeSignature(edge) {
  return JSON.stringify([edge?.id, edge?.from, edge?.to, edge?.type, edge?.label, edge?.semanticRole, edge?.dataRef]);
}

function processEntityDataRef(semanticModel, ref) {
  const match = String(ref || "").match(/^(tasks|events|states|decisions)\/(.+)$/u);
  if (!match) return null;
  const index = array(semanticModel?.[match[1]]).findIndex((row) => row.id === match[2]);
  return index >= 0 ? `/${match[1]}/${index}` : null;
}

function validateArchitecture(spec) {
  const findings = [];
  const nodes = array(spec.nodes);
  const edges = array(spec.edges);
  const visibleLayers = new Set();
  for (const node of nodes) {
    if (!ARCHITECTURE_LAYER_ORDER.includes(node.lane) || architectureLayerIdForNode(node) !== node.lane) {
      findings.push(finding("SEM_ARCH_LAYER_MISMATCH", "BLOCKER", { page: spec.pageNumber, nodeId: node.id, reason: "invalid_layer" }));
    } else {
      visibleLayers.add(node.lane);
    }
    if (isNamedTechnology(node.label)) {
      const sourcedFact = FACTUAL_TRUTH.has(node.truthStatus) && array(node.sourceIds).length > 0;
      const derivedRecommendation = node.truthStatus === "recommended" && Boolean(node.derivationRuleId);
      if (!sourcedFact && !derivedRecommendation) {
        findings.push(finding("SEM_ARCH_UNGROUNDED_TECH", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
      }
    }
  }
  for (const layerId of ARCHITECTURE_LAYER_ORDER) {
    if (!visibleLayers.has(layerId)) findings.push(finding("SEM_ARCH_LAYER_MISMATCH", "BLOCKER", { page: spec.pageNumber, layerId, reason: "layer_missing" }));
  }
  if (spec.variant === "pending") {
    if (edges.length || spec.layout?.engine !== "questions" || nodes.filter((row) => row.type === "question").length < 2) findings.push(finding("SEM_ARCH_PATH_MISSING", "BLOCKER", { page: spec.pageNumber }));
    return findings;
  }
  const channels = nodes.filter((node) => node.type === "channel");
  const cores = nodes.filter((node) => ["application", "service"].includes(node.type));
  const applications = nodes.filter((node) => node.type === "application");
  const apiBoundaries = nodes.filter((node) => node.type === "service" && /\bAPI\b|application\s+programming\s+interface|dasturiy\s+interfeys|программн\p{L}*\s+интерфейс/iu.test(node.label));
  const dataStores = nodes.filter((node) => node.type === "data_store");
  const externals = nodes.filter((node) => node.type === "external_system");
  const users = nodes.filter((node) => node.type === "surface");
  const trustedGroups = array(spec.groups).filter((row) => row.type === "boundary" && row.semanticRole === "owned");
  if (!cores.length) findings.push(finding("SEM_ARCH_PATH_MISSING", "BLOCKER", { page: spec.pageNumber, reason: "core_missing" }));
  if (!trustedGroups.some((row) => row.nodeIds.some((id) => cores.some((core) => core.id === id)))) findings.push(finding("SEM_ARCH_TRUST_BOUNDARY_EMPTY", "BLOCKER", { page: spec.pageNumber }));
  if (spec.variant === "layered") {
    if (!channels.length) findings.push(finding("SEM_ARCH_PATH_MISSING", "BLOCKER", { page: spec.pageNumber, reason: "channel_missing" }));
    for (const channel of channels) if (!cores.some((core) => directedReachable(spec, channel.id).has(core.id))) findings.push(finding("SEM_ARCH_PATH_MISSING", "BLOCKER", { page: spec.pageNumber, nodeId: channel.id }));
    if (!dataStores.length) findings.push(finding("SEM_ARCH_LAYER_MISMATCH", "BLOCKER", { page: spec.pageNumber, reason: "data_store_missing" }));
    if (!apiBoundaries.length) findings.push(finding("SEM_ARCH_API_BOUNDARY_MISSING", "BLOCKER", { page: spec.pageNumber }));
    for (const channel of channels) {
      if (apiBoundaries.length && !apiBoundaries.some((api) => directedReachable(spec, channel.id).has(api.id))) {
        findings.push(finding("SEM_ARCH_PATH_MISSING", "BLOCKER", { page: spec.pageNumber, nodeId: channel.id, reason: "frontend_api_path_missing" }));
      }
    }
    for (const api of apiBoundaries) {
      const reachable = directedReachable(spec, api.id);
      if (!applications.some((application) => reachable.has(application.id))) findings.push(finding("SEM_ARCH_PATH_MISSING", "BLOCKER", { page: spec.pageNumber, nodeId: api.id, reason: "api_core_path_missing" }));
      if (!dataStores.some((store) => reachable.has(store.id))) findings.push(finding("SEM_ARCH_PATH_MISSING", "BLOCKER", { page: spec.pageNumber, nodeId: api.id, reason: "api_data_path_missing" }));
    }
    for (const store of dataStores) {
      if (isAbstractDataStoreLabel(store.label)) findings.push(finding("SEM_ARCH_DATA_MODEL_ABSTRACT", "BLOCKER", { page: spec.pageNumber, nodeId: store.id }));
    }
  } else if (spec.variant === "context") {
    if (!edges.length || !nodes.some((row) => row.type === "question" && /to confirm/iu.test(row.label))) findings.push(finding("SEM_ARCH_CONTEXT_FALLBACK_INVALID", "BLOCKER", { page: spec.pageNumber }));
  }
  for (const user of users) {
    if (!/^\/actors\/[0-9]+$/u.test(String(user.dataRef || "")) || !edges.some((edge) => edge.from === user.id && channels.some((channel) => channel.id === edge.to))) {
      findings.push(finding("SEM_ARCH_PATH_MISSING", "BLOCKER", { page: spec.pageNumber, nodeId: user.id, reason: "user_platform_path_missing" }));
    }
  }
  for (const external of externals) {
    if (!edges.some((edge) => edge.from === external.id || edge.to === external.id)) findings.push(finding("SEM_ARCH_EXTERNAL_UNCONNECTED", "BLOCKER", { page: spec.pageNumber, nodeId: external.id }));
    if (external.semanticRole !== "partner" || trustedGroups.some((group) => group.nodeIds.includes(external.id))) findings.push(finding("SEM_ARCH_OWNERSHIP_INVALID", "BLOCKER", { page: spec.pageNumber, nodeId: external.id }));
  }
  for (const store of dataStores) if (!trustedGroups.some((group) => group.nodeIds.includes(store.id))) findings.push(finding("SEM_ARCH_LAYER_MISMATCH", "BLOCKER", { page: spec.pageNumber, nodeId: store.id }));
  for (const node of nodes) {
    if (/^\/(pricing|infraExternal)(\/|$)/u.test(String(node.dataRef || "")) || /^\/pricing\/infraExternal(\/|$)/u.test(String(node.dataRef || ""))) findings.push(finding("SEM_ARCH_COST_ITEM_AS_COMPONENT", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
  }
  return findings;
}

function isNamedTechnology(value) {
  return /\b(?:React(?:\s+Native)?|Next(?:\.js)?|Nest(?:JS)?|Node(?:\.js)?|TypeScript|Tailwind|PostgreSQL|MySQL|MongoDB|Redis|Kafka|ClickHouse|Firebase|Supabase|Docker|Kubernetes|AWS|Azure|GCP)\b/iu.test(String(value || ""));
}

function isAbstractDataStoreLabel(value) {
  return /^(?:operational\s+(?:data|store|datastore)|data(?:base)?(?:\s+store)?|operatsion\s+ma['’ʼ]?lumotlar|операционн\p{L}*\s+данн\p{L}*)$/iu.test(String(value || "").trim());
}

function validateRoadmap(spec, semanticModel = {}) {
  const findings = [];
  const nodes = array(spec.nodes);
  const edges = array(spec.edges);
  if (spec.variant === "pending") {
    if (spec.timeScale !== null || edges.length || spec.layout?.engine !== "questions" || nodes.filter((row) => row.type === "question").length < 2) findings.push(finding("SEM_ROADMAP_PENDING_INVALID", "BLOCKER", { page: spec.pageNumber }));
    return findings;
  }
  const scale = spec.timeScale;
  if (!scale || !Number.isInteger(scale.start) || !Number.isInteger(scale.end) || scale.start < 1 || scale.end < scale.start) {
    findings.push(finding("SEM_ROADMAP_RANGE_INVALID", "BLOCKER", { page: spec.pageNumber, reason: "invalid_scale" }));
    return findings;
  }
  const phaseNodes = nodes.filter((row) => row.type === "phase");
  const workstreamNodes = nodes.filter((row) => row.type === "task");
  const unexpectedNodes = nodes.filter((row) => !["phase", "task"].includes(row.type));
  if (spec.variant === "gantt" && (
    spec.layout?.engine !== "gantt"
    || !phaseNodes.length
    || !workstreamNodes.length
    || unexpectedNodes.length
    || phaseNodes.some((row) => !row.time)
    || workstreamNodes.some((row) => !row.time)
    || workstreamNodes.length > ROADMAP_WORKSTREAM_PAGE_LIMIT
  )) findings.push(finding("SEM_ROADMAP_RANGE_INVALID", "BLOCKER", { page: spec.pageNumber, reason: "gantt_requires_phase_and_terminal_workstream_spans" }));
  if (spec.variant === "milestone" && (spec.layout?.engine !== "milestone_timeline" || nodes.some((row) => row.type !== "milestone" || (row.time && row.time.start !== row.time.end)))) findings.push(finding("SEM_ROADMAP_FAKE_SPAN", "BLOCKER", { page: spec.pageNumber }));
  for (const node of nodes) {
    if (!node.time) continue;
    if (node.time.unit !== scale.unit || !Number.isInteger(node.time.start) || !Number.isInteger(node.time.end) || node.time.start > node.time.end || node.time.start < scale.start || node.time.end > scale.end) findings.push(finding("SEM_ROADMAP_RANGE_INVALID", "BLOCKER", { page: spec.pageNumber, nodeId: node.id }));
  }
  for (const edge of edges.filter((row) => row.type === "dependency")) {
    const from = nodes.find((row) => row.id === edge.from);
    const to = nodes.find((row) => row.id === edge.to);
    if (!edge.dependency || !from?.time || !to?.time) {
      findings.push(finding("SEM_ROADMAP_DEPENDENCY_INVALID", "BLOCKER", { page: spec.pageNumber, edgeId: edge.id }));
      continue;
    }
    const { type, lag, allowOverlap } = edge.dependency;
    const inBounds = Number.isInteger(lag) && lag >= 0;
    let satisfied = inBounds;
    if (!allowOverlap && type === "finish_to_start") satisfied &&= to.time.start >= from.time.end + 1 + lag;
    if (type === "start_to_start") satisfied &&= to.time.start >= from.time.start + lag;
    if (type === "finish_to_finish") satisfied &&= to.time.end >= from.time.end + lag;
    if (!satisfied) findings.push(finding("SEM_ROADMAP_DEPENDENCY_INVALID", "BLOCKER", { page: spec.pageNumber, edgeId: edge.id }));
  }
  const expectedDependencies = array(semanticModel?.roadmap?.dependencies);
  if (expectedDependencies.length && spec.variant !== "pending") {
    const actual = edges.filter((row) => row.type === "dependency");
    if (actual.length !== expectedDependencies.length) findings.push(finding("SEM_ROADMAP_DEPENDENCY_INVALID", "BLOCKER", { page: spec.pageNumber, reason: "dependency_count_mismatch" }));
  }
  if (spec.variant === "gantt") {
    const expectedSegments = buildRoadmapWorkstreamSegments(semanticModel);
    const effectiveSegmentIndex = Number(spec.segmentIndex || 1);
    const expectedSegment = expectedSegments[effectiveSegmentIndex - 1] || [];
    const expectedIds = expectedSegment.map((row) => String(row.productLeafId));
    const actualIds = workstreamNodes.map((row) => String(row.id));
    const segmentMetadataInvalid = !Number.isInteger(effectiveSegmentIndex)
      || effectiveSegmentIndex < 1
      || effectiveSegmentIndex > expectedSegments.length
      || Number(spec.segmentCount || 1) !== expectedSegments.length;
    if (segmentMetadataInvalid || expectedIds.length !== actualIds.length || expectedIds.some((id, index) => id !== actualIds[index])) {
      findings.push(finding("SEM_ROADMAP_SCOPE_COVERAGE_MISMATCH", "BLOCKER", {
        page: spec.pageNumber,
        segmentIndex: effectiveSegmentIndex,
        expectedSegmentCount: expectedSegments.length,
        expectedIds,
        actualIds,
      }));
    }
    if (new Set(actualIds).size !== actualIds.length) {
      findings.push(finding("SEM_ROADMAP_SCOPE_COVERAGE_MISMATCH", "BLOCKER", { page: spec.pageNumber, reason: "duplicate_terminal_workstream" }));
    }
  }
  return findings;
}

function validateRoadmapInventoryCoverage(specs, semanticModel, presentationPlan) {
  const roadmapPageNumbers = new Set(array(presentationPlan?.pages)
    .filter((page) => page.kind === "roadmap")
    .map((page) => Number(page.pageNumber)));
  const roadmapSpecs = array(specs).filter((spec) => spec.kind === "gantt" && (
    roadmapPageNumbers.size ? roadmapPageNumbers.has(Number(spec.pageNumber)) : true
  ));
  const detailedSpecs = roadmapSpecs.filter((spec) => spec.variant === "gantt")
    .sort((left, right) => Number(left.segmentIndex || 1) - Number(right.segmentIndex || 1));
  if (!detailedSpecs.length) return [];

  const expectedSegments = buildRoadmapWorkstreamSegments(semanticModel);
  const expectedIds = expectedSegments.flatMap((segment) => segment.map((row) => String(row.productLeafId)));
  const actualIds = detailedSpecs.flatMap((spec) => array(spec.nodes)
    .filter((node) => node.type === "task")
    .map((node) => String(node.id)));
  const actualSegmentIndices = detailedSpecs.map((spec) => Number(spec.segmentIndex || 1));
  const completeSegmentSequence = detailedSpecs.length === expectedSegments.length
    && detailedSpecs.length === roadmapSpecs.length
    && actualSegmentIndices.every((value, index) => value === index + 1);
  const completeInventory = expectedIds.length === actualIds.length
    && expectedIds.every((id, index) => id === actualIds[index])
    && new Set(actualIds).size === actualIds.length;
  if (completeSegmentSequence && completeInventory) return [];
  return [finding("SEM_ROADMAP_SCOPE_COVERAGE_MISMATCH", "BLOCKER", {
    reason: "roadmap_continuations_do_not_cover_canonical_terminal_inventory",
    expectedSegmentCount: expectedSegments.length,
    actualSegmentIndices,
    expectedIds,
    actualIds,
  })];
}

function validateAggregation(spec) {
  const findings = [];
  const mappings = array(spec.aggregationMapping);
  const ids = idSet(mappings);
  if (ids.duplicates.length) findings.push(finding("SEM_DEGRADATION_INVALID", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, ids: ids.duplicates }));
  for (const row of mappings) {
    const node = array(spec.nodes).find((item) => item.id === row.aggregateNodeId);
    if (!node || node.type !== "aggregate" || !array(row.sourceEntityIds).length) findings.push(finding("SEM_DEGRADATION_INVALID", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, aggregationId: row.id }));
  }
  if (mappings.length) {
    const referenced = new Set(array(spec.degradation?.aggregationMappingIds));
    if (!spec.degradation || mappings.some((row) => !referenced.has(row.id)) || referenced.size !== mappings.length) findings.push(finding("SEM_DEGRADATION_INVALID", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId }));
  } else if (spec.degradation) {
    findings.push(finding("SEM_DEGRADATION_INVALID", "BLOCKER", { visualizationSpecId: spec.visualizationSpecId, reason: "degradation_without_mapping" }));
  }
  return findings;
}

function validateProvenance(value, context) {
  const findings = [];
  const sources = array(value?.sourceIds);
  if (FACTUAL_TRUTH.has(value?.truthStatus) && !sources.length) findings.push(finding("SEM_PROVENANCE_MISSING", PENDING_VARIANTS.has(context.variant) ? "ERROR" : "BLOCKER", context));
  if (DERIVED_TRUTH.has(value?.truthStatus) && !sources.length && !value?.derivationRuleId) findings.push(finding("SEM_PROVENANCE_MISSING", "BLOCKER", context));
  if (context.sourceRegistry) {
    const unknownSourceIds = sources.filter((id) => !context.sourceRegistry.has(id));
    if (unknownSourceIds.length) findings.push(finding("SEM_PROVENANCE_MISSING", "BLOCKER", { ...context, reason: "unknown_source_id", sourceIds: unknownSourceIds }));
    const unusableSourceIds = sources.filter((id) => context.sourceRegistry.has(id) && context.sourceRegistry.get(id)?.usable === false);
    if (unusableSourceIds.length) findings.push(finding("SEM_PROVENANCE_MISSING", "BLOCKER", { ...context, reason: "unusable_source_id", sourceIds: unusableSourceIds }));
  }
  return findings;
}

function marketShareMatches(child, parent) {
  if (child?.shareOfParent == null) return true;
  const expected = Number(parent?.value) * Number(child.shareOfParent);
  const actual = Number(child?.value);
  return Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(actual - expected) / Math.max(1, Math.abs(actual)) <= 0.02;
}

function observedFactualMarketNodeHasUsableSource(node, sourceRegistry) {
  if (String(node?.claimNature || "").trim().toLowerCase() !== "observed" || !FACTUAL_TRUTH.has(node?.truthStatus)) return false;
  const sourceIds = array(node?.sourceIds).map(String);
  if (!sourceIds.length) return false;
  if (!sourceRegistry) return true;
  return sourceIds.some((sourceId) => sourceRegistry.get(sourceId)?.usable === true);
}

function idSet(rows) {
  const set = new Set();
  const duplicates = [];
  for (const row of rows) {
    if (set.has(row?.id)) duplicates.push(row?.id);
    set.add(row?.id);
  }
  return { set, duplicates };
}

function orphanNodes(spec) {
  const connected = new Set(array(spec.edges).flatMap((edge) => [edge.from, edge.to]));
  return array(spec.nodes).filter((node) => !connected.has(node.id) && !["annotation", "note", "aggregate", "question"].includes(node.type));
}

function directedReachable(spec, rootId) {
  const reachable = new Set(rootId ? [rootId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of array(spec.edges)) {
      if (edge.direction === "none") continue;
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

function normalizeSourceRegistry(value) {
  if (!value) return null;
  if (value instanceof Map) return new Map([...value.entries()].map(([id, row]) => [String(id), normalizeSourceEntry(id, row)]));
  if (value instanceof Set) return new Map([...value].map((id) => [String(id), normalizeSourceEntry(id, null)]));
  if (Array.isArray(value)) return new Map(value
    .map((row) => typeof row === "string" ? [row, normalizeSourceEntry(row, null)] : [row?.id, normalizeSourceEntry(row?.id, row)])
    .filter(([id]) => Boolean(id))
    .map(([id, row]) => [String(id), row]));
  if (typeof value === "object") return new Map(Object.entries(value).map(([id, row]) => [String(id), normalizeSourceEntry(id, row)]));
  return null;
}

function normalizeSourceEntry(id, value) {
  const row = value && typeof value === "object" ? value : {};
  const status = String(row.status || "").trim().toLowerCase();
  const unusable = /^(?:failed|error|blocked|unreadable|empty|missing|unavailable)(?:\b|:)/u.test(status);
  return { id: String(id || row.id || ""), status: status || null, usable: !unusable };
}

function normalizeLabel(value) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function finding(code, severity, details = {}) {
  return { code, severity, ...details };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
