import { ARCHITECTURE_LAYER_DEFINITIONS, architectureLayerIdForNode } from "./kp_architecture_layers.mjs";

export function layoutVisualization(spec, canvas = { width: 1312, height: 560 }) {
  if (spec.kind === "nested_market") return layoutNestedMarket(spec, canvas);
  if (spec.kind === "ownership_boundary") return layoutOwnershipBoundary(spec, canvas);
  if (spec.kind === "hub_spoke") return layoutHubSpoke(spec, canvas);
  if (spec.kind === "bpmn") return layoutBpmn(spec, canvas);
  if (spec.kind === "architecture") return layoutArchitecture(spec, canvas);
  return layoutGantt(spec, canvas);
}

export function layoutNestedMarket(spec, canvas) {
  const nodes = {};
  if (spec.variant === "formula_pending") {
    const formulas = spec.nodes.filter((node) => node.id.startsWith("FORMULA-"));
    const questions = spec.nodes.filter((node) => !node.id.startsWith("FORMULA-"));
    const formulaWidth = Math.min(330, (canvas.width - 80 - (Math.max(1, formulas.length) - 1) * 24) / Math.max(1, formulas.length));
    formulas.forEach((node, index) => {
      nodes[node.id] = { x: 40 + index * (formulaWidth + 24), y: 62, w: formulaWidth, h: 92 };
    });
    const questionWidth = Math.min(310, (canvas.width - 120 - (Math.max(1, questions.length) - 1) * 24) / Math.max(1, questions.length));
    questions.forEach((node, index) => {
      nodes[node.id] = { x: 60 + index * (questionWidth + 24), y: canvas.height - 156, w: questionWidth, h: 82 };
    });
    return buildLayout(spec, canvas, nodes);
  }
  const count = Math.max(1, spec.nodes.length);
  const gap = 16;
  const verticalPadding = 40;
  const availableHeight = canvas.height - verticalPadding * 2;
  const nodeHeight = Math.min(92, (availableHeight - gap * Math.max(0, count - 1)) / count);
  const totalHeight = nodeHeight * count + gap * Math.max(0, count - 1);
  const startY = (canvas.height - totalHeight) / 2;
  const initialInset = 44;
  const maxInset = Math.min(canvas.width * 0.32, (canvas.width - 320) / 2);
  const insetStep = count > 1 ? (maxInset - initialInset) / (count - 1) : 0;
  spec.nodes.forEach((node, index) => {
    const inset = initialInset + index * insetStep;
    nodes[node.id] = { x: inset, y: startY + index * (nodeHeight + gap), w: canvas.width - inset * 2, h: nodeHeight };
  });
  return buildLayout(spec, canvas, nodes);
}

export function layoutOwnershipBoundary(spec, canvas) {
  const nodes = {};
  if (spec.variant === "pending") {
    placeQuestionGrid(spec.nodes, nodes, canvas);
    return buildLayout(spec, canvas, nodes);
  }
  const core = spec.nodes.filter((node) => node.type === "core");
  const owned = spec.nodes.filter((node) => node.semanticRole === "owned" && node.type !== "core");
  const partners = spec.nodes.filter((node) => node.semanticRole === "partner");
  const deferred = spec.nodes.filter((node) => node.semanticRole === "deferred");
  const neutral = spec.nodes.filter((node) => ![...core, ...owned, ...partners, ...deferred].includes(node));
  placeColumn(neutral, nodes, 30, 80, 170);
  if (core[0]) nodes[core[0].id] = { x: canvas.width * 0.45 - 110, y: 48, w: 220, h: 78 };
  // Five owned capabilities need three columns; otherwise the third row
  // collides with the deferred boundary on the 1120x540 production canvas.
  placeGrid(owned, nodes, canvas.width * 0.18, 185, 180, 86, Math.min(3, Math.max(1, owned.length)));
  placeColumn(partners, nodes, canvas.width - 245, 150, 205);
  placeGrid(deferred, nodes, canvas.width * 0.2, canvas.height - 142, 158, 68, Math.min(4, Math.max(1, deferred.length)));
  return buildLayout(spec, canvas, nodes);
}

export function layoutHubSpoke(spec, canvas) {
  const nodes = {};
  if (spec.variant === "pending") {
    placeQuestionGrid(spec.nodes, nodes, canvas);
    return buildLayout(spec, canvas, nodes);
  }
  if (spec.variant === "left_to_right_tree") {
    layoutLeftToRightProductTree(spec, nodes, canvas);
    return buildLayout(spec, canvas, nodes);
  }
  const root = spec.nodes.find((node) => node.type === "core") || spec.nodes[0];
  const rootWidth = Math.min(220, canvas.width * 0.2);
  const rootRect = { x: canvas.width / 2 - rootWidth / 2, y: canvas.height / 2 - 44, w: rootWidth, h: 88 };
  nodes[root.id] = rootRect;

  // The planner emits a depth-two rooted tree. Keep each capability on the
  // same side as its domain so a domain-to-capability edge can never traverse
  // the central root merely because of array order.
  const branchIds = (spec.edges || []).filter((edge) => edge.from === root.id).map((edge) => edge.to);
  const branches = branchIds.map((id) => spec.nodes.find((node) => node.id === id)).filter(Boolean);
  const branchModels = branches.map((branch) => ({
    branch,
    children: (spec.edges || [])
      .filter((edge) => edge.from === branch.id)
      .map((edge) => spec.nodes.find((node) => node.id === edge.to))
      .filter(Boolean),
  }));
  const left = branchModels.filter((_, index) => index % 2 === 0);
  const right = branchModels.filter((_, index) => index % 2 === 1);
  const innerWidth = Math.min(180, canvas.width * 0.17);
  const outerWidth = innerWidth;
  const innerGap = Math.max(18, canvas.width * 0.018);
  layoutTreeSide(left, nodes, canvas, {
    branchX: rootRect.x - innerGap - innerWidth,
    childX: 30,
    width: innerWidth,
  });
  layoutTreeSide(right, nodes, canvas, {
    branchX: rootRect.x + rootRect.w + innerGap,
    childX: canvas.width - 30 - outerWidth,
    width: outerWidth,
  });
  return buildLayout(spec, canvas, nodes);
}

function layoutLeftToRightProductTree(spec, nodes, canvas) {
  const root = spec.nodes.find((node) => node.type === "core") || spec.nodes[0];
  if (!root) return;
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]));
  const childIds = (parentId) => (spec.edges || []).filter((edge) => edge.from === parentId).map((edge) => edge.to);
  const domains = childIds(root.id).map((id) => nodeById.get(id)).filter(Boolean);
  const functionModels = domains.flatMap((domain) => {
    const functions = childIds(domain.id).map((id) => nodeById.get(id)).filter(Boolean);
    return functions.length
      ? functions.map((item) => ({ domain, item, details: childIds(item.id).map((id) => nodeById.get(id)).filter(Boolean) }))
      : [{ domain, item: null, details: [] }];
  });
  const rows = functionModels.flatMap((model) => model.details.length
    ? model.details.map((detail) => ({ ...model, detail }))
    : [{ ...model, detail: null }]);
  const rowCount = Math.max(1, rows.length);
  const top = 20;
  const usableHeight = Math.max(1, canvas.height - top * 2);
  const slotHeight = usableHeight / rowCount;
  const minimumNodeHeight = rowCount > 13 ? 34 : 38;
  const nodeHeight = Math.min(50, Math.max(minimumNodeHeight, slotHeight - 6));
  const hasDetails = rows.some((row) => row.detail);
  const rootRect = { x: 26, y: canvas.height / 2 - 36, w: 180, h: 72 };
  const domainX = 250;
  const domainWidth = 210;
  const functionX = hasDetails ? 530 : 720;
  const functionWidth = hasDetails ? 260 : 350;
  const detailX = 850;
  const detailWidth = Math.max(260, canvas.width - detailX - 26);
  nodes[root.id] = rootRect;

  const centersByDomain = new Map(domains.map((domain) => [domain.id, []]));
  const centersByFunction = new Map(functionModels.filter((model) => model.item).map((model) => [model.item.id, []]));
  rows.forEach((row, index) => {
    const centerY = top + slotHeight * (index + 0.5);
    centersByDomain.get(row.domain.id)?.push(centerY);
    if (row.item) centersByFunction.get(row.item.id)?.push(centerY);
    if (row.detail) nodes[row.detail.id] = { x: detailX, y: centerY - nodeHeight / 2, w: detailWidth, h: nodeHeight };
  });
  for (const model of functionModels.filter((row) => row.item)) {
    const centers = centersByFunction.get(model.item.id) || [canvas.height / 2];
    const centerY = centers.reduce((sum, value) => sum + value, 0) / Math.max(1, centers.length);
    nodes[model.item.id] = { x: functionX, y: centerY - nodeHeight / 2, w: functionWidth, h: nodeHeight };
  }
  for (const domain of domains) {
    const centers = centersByDomain.get(domain.id) || [canvas.height / 2];
    const centerY = centers.reduce((sum, value) => sum + value, 0) / Math.max(1, centers.length);
    nodes[domain.id] = { x: domainX, y: centerY - nodeHeight / 2, w: domainWidth, h: nodeHeight };
  }
}

export function layoutBpmn(spec, canvas) {
  const nodes = {};
  if (spec.variant === "questions") {
    placeQuestionGrid(spec.nodes, nodes, canvas);
    return buildLayout(spec, canvas, nodes);
  }
  const laneGroups = (spec.groups || []).filter((group) => ["lane", "pool"].includes(group.type));
  const { order, depthByNode } = bpmnTopologicalColumns(spec);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const lanes = laneGroups
    .map((group, index) => ({
      id: group.id,
      label: group.label,
      type: group.type,
      semanticRole: group.semanticRole,
      sourceIndex: index,
      firstColumn: Math.min(...(group.nodeIds || []).map((id) => depthByNode.get(id) ?? Number.MAX_SAFE_INTEGER)),
      firstOrder: Math.min(...(group.nodeIds || []).map((id) => orderIndex.get(id) ?? Number.MAX_SAFE_INTEGER)),
    }))
    .sort((left, right) => left.firstColumn - right.firstColumn || left.firstOrder - right.firstOrder || left.sourceIndex - right.sourceIndex);
  const top = 16;
  const bottom = 16;
  const labelWidth = 128;
  const laneHeight = (canvas.height - top - bottom) / Math.max(1, lanes.length);
  const bpmnLanes = lanes.map((lane, index) => ({
    ...lane,
    x: 0,
    y: top + index * laneHeight,
    w: canvas.width,
    h: laneHeight,
    labelWidth,
  }));
  const laneById = new Map(bpmnLanes.map((lane) => [lane.id, lane]));
  const maxDepth = Math.max(1, ...spec.nodes.map((node) => depthByNode.get(node.id) || 0));
  const centerLeft = labelWidth + 54;
  const centerRight = canvas.width - 54;
  const columnStep = (centerRight - centerLeft) / maxDepth;
  const denseColumns = maxDepth >= 10;
  // Dense subprocess pages use more graph columns, so the task width follows
  // the available column step instead of holding a 92px floor that makes
  // adjacent nodes overlap. Short flows still retain the larger card size.
  const taskWidth = denseColumns
    ? Math.min(106, Math.max(64, columnStep - 10))
    : Math.min(138, Math.max(92, columnStep - 8));

  for (const node of spec.nodes) {
    const lane = laneById.get(node.lane) || bpmnLanes[0] || { y: top, h: canvas.height - top - bottom };
    const depth = depthByNode.get(node.id) || 0;
    const size = node.type === "gateway"
      ? { w: denseColumns ? 72 : 84, h: Math.min(76, Math.max(66, lane.h - 12)) }
      : node.type === "start_event" || node.type === "end_event"
        ? { w: denseColumns ? 72 : 90, h: Math.min(80, Math.max(68, lane.h - 10)) }
        : { w: taskWidth, h: Math.min(80, Math.max(52, lane.h - 24)) };
    const centerX = centerLeft + (depth / maxDepth) * (centerRight - centerLeft);
    // Events and gateways draw their glyph around rect.y + 20; align that
    // glyph with the lane's task center so same-lane connectors stay level.
    const glyphAligned = ["start_event", "end_event", "gateway"].includes(node.type);
    const laneCenteredY = lane.y + (lane.h - size.h) / 2;
    const glyphCenteredY = lane.y + lane.h / 2 - 20;
    const y = glyphAligned
      ? Math.max(lane.y + 4, Math.min(lane.y + lane.h - size.h - 4, glyphCenteredY))
      : laneCenteredY;
    nodes[node.id] = {
      x: Math.max(labelWidth + 10, Math.min(canvas.width - size.w - 8, centerX - size.w / 2)),
      y,
      ...size,
    };
  }

  const layout = buildLayout(spec, canvas, nodes);
  layout.edges = routeBpmnEdges(spec, nodes, canvas);
  layout.groups = Object.fromEntries(bpmnLanes.map((lane) => [lane.id, { x: lane.x, y: lane.y, w: lane.w, h: lane.h }]));
  layout.bpmnLanes = bpmnLanes;
  layout.bpmnEdgeLabels = placeBpmnEdgeLabels(spec, layout.edges, nodes, canvas);
  return layout;
}

function bpmnTopologicalColumns(spec) {
  const nodeIds = new Set((spec.nodes || []).map((node) => node.id));
  const incoming = new Map([...nodeIds].map((id) => [id, []]));
  const outgoing = new Map([...nodeIds].map((id) => [id, []]));
  for (const edge of spec.edges || []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const sourceOrder = new Map((spec.nodes || []).map((node, index) => [node.id, index]));
  const remaining = new Map([...incoming].map(([id, parents]) => [id, parents.length]));
  const queue = [...nodeIds]
    .filter((id) => remaining.get(id) === 0)
    .sort((left, right) => (sourceOrder.get(left) || 0) - (sourceOrder.get(right) || 0));
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const target of outgoing.get(id) || []) {
      remaining.set(target, remaining.get(target) - 1);
      if (remaining.get(target) === 0) {
        queue.push(target);
        queue.sort((left, right) => (sourceOrder.get(left) || 0) - (sourceOrder.get(right) || 0));
      }
    }
  }
  for (const node of spec.nodes || []) if (!order.includes(node.id)) order.push(node.id);
  const depthByNode = new Map();
  const occupiedByLane = new Map();
  const nodeById = new Map((spec.nodes || []).map((node) => [node.id, node]));
  for (const id of order) {
    const parentDepths = (incoming.get(id) || []).map((parentId) => depthByNode.get(parentId)).filter(Number.isFinite);
    let depth = parentDepths.length ? Math.max(...parentDepths) + 1 : 0;
    const lane = nodeById.get(id)?.lane || "__unassigned__";
    const occupied = occupiedByLane.get(lane) || new Set();
    while (occupied.has(depth)) depth += 1;
    depthByNode.set(id, depth);
    occupied.add(depth);
    occupiedByLane.set(lane, occupied);
  }
  return { order, depthByNode };
}

function routeBpmnEdges(spec, nodes, canvas) {
  const paths = {};
  const nodeById = new Map((spec.nodes || []).map((node) => [node.id, node]));
  for (const edge of spec.edges || []) {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!from || !to || !fromNode || !toNode) continue;
    const sameLane = fromNode.lane === toNode.lane;
    const fromCenterX = from.x + from.w / 2;
    const toCenterX = to.x + to.w / 2;
    const movesRight = toCenterX > fromCenterX + 2;
    if (sameLane && movesRight) {
      const source = bpmnNodePort(from, fromNode, "right");
      const target = bpmnNodePort(to, toNode, "left");
      const direct = Math.abs(source.y - target.y) <= 2
        ? [source, target]
        : orthogonalPath(source, target);
      if (!bpmnPathHitsNode(direct, nodes, edge.from, edge.to)) {
        paths[edge.id] = direct;
        continue;
      }
      // A forward branch may intentionally skip a sibling node in the same
      // lane (for example “declined” bypassing the refund task). Route that
      // connector on a short rail above or below the cards instead of drawing
      // through the skipped branch.
      const topRailY = Math.min(from.y, to.y) - 12;
      const useTopRail = topRailY >= 4;
      const railY = useTopRail ? topRailY : Math.min(canvas.height - 4, Math.max(from.y + from.h, to.y + to.h) + 12);
      const sourceRail = bpmnNodePort(from, fromNode, useTopRail ? "top" : "bottom");
      const targetRail = bpmnNodePort(to, toNode, useTopRail ? "top" : "bottom");
      paths[edge.id] = [sourceRail, { x: sourceRail.x, y: railY }, { x: targetRail.x, y: railY }, targetRail];
      continue;
    }
    if (sameLane) {
      paths[edge.id] = routeBackEdge(from, to, canvas);
      continue;
    }
    if (movesRight) {
      // Lane-crossing connectors prefer a single clean elbow: descending
      // flows drop from the source's bottom edge and enter the target's left
      // port; ascending flows run level and rise into the target's bottom
      // edge. Gateways keep a short two-corner entry/exit so the diamond's
      // corner ports stay unambiguous. Any candidate that would cut through
      // another node falls back to the mid-rail route.
      const rightPort = bpmnNodePort(from, fromNode, "right");
      const leftTarget = bpmnNodePort(to, toNode, "left");
      const goingDown = to.y + to.h / 2 > from.y + from.h / 2;
      const clearOfNodes = (points) => !bpmnPathHitsNode(points, nodes, edge.from, edge.to);
      let candidate = null;
      if (goingDown) {
        const bottomPort = bpmnNodePort(from, fromNode, "bottom");
        if (leftTarget.x > bottomPort.x + 8) {
          candidate = [bottomPort, { x: bottomPort.x, y: leftTarget.y }, leftTarget];
        }
      } else if (fromNode.type === "gateway" || ["gateway", "start_event", "end_event"].includes(toNode.type)) {
        // Ascending flows into glyph nodes (diamonds, event circles) rise on
        // a short rail left of the glyph and enter its left port, so the line
        // never cuts through the caption under the glyph.
        const railX = leftTarget.x - 14;
        if (railX > rightPort.x + 6) {
          candidate = [rightPort, { x: railX, y: rightPort.y }, { x: railX, y: leftTarget.y }, leftTarget];
        }
      } else {
        const bottomTarget = bpmnNodePort(to, toNode, "bottom");
        if (bottomTarget.x > rightPort.x + 8) {
          candidate = [rightPort, { x: bottomTarget.x, y: rightPort.y }, bottomTarget];
        }
      }
      if (candidate && clearOfNodes(candidate)) {
        paths[edge.id] = candidate;
        continue;
      }
      const railX = (rightPort.x + leftTarget.x) / 2;
      paths[edge.id] = [rightPort, { x: railX, y: rightPort.y }, { x: railX, y: leftTarget.y }, leftTarget];
      continue;
    }
    // Parallel gateway branches can share a graph column while living in
    // different lanes. Use the clear gutter to the right of the column so
    // the connector does not cut through nodes in intermediate lanes.
    const source = bpmnNodePort(from, fromNode, "right");
    const target = bpmnNodePort(to, toNode, "right");
    const railX = Math.min(canvas.width - 10, Math.max(source.x, target.x) + 18);
    paths[edge.id] = [source, { x: railX, y: source.y }, { x: railX, y: target.y }, target];
  }
  return paths;
}

function bpmnPathHitsNode(points, nodes, fromId, toId) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    for (const [id, rect] of Object.entries(nodes)) {
      if (id === fromId || id === toId) continue;
      // Orthogonal segments have zero thickness, so an axis-aligned overlap
      // test with a 1px tolerance detects a genuine pass-through.
      if (maxX > rect.x + 1 && minX < rect.x + rect.w - 1 && maxY > rect.y + 1 && minY < rect.y + rect.h - 1) return true;
    }
  }
  return false;
}

function bpmnNodePort(rect, node, side) {
  if (!["start_event", "end_event", "gateway"].includes(node.type)) return rectPort(rect, side);
  const size = node.type === "gateway" ? 40 : 34;
  const center = { x: rect.x + rect.w / 2, y: rect.y + 20 };
  if (side === "left") return { x: center.x - size / 2, y: center.y };
  if (side === "right") return { x: center.x + size / 2, y: center.y };
  if (side === "top") return { x: center.x, y: center.y - size / 2 };
  return { x: center.x, y: center.y + size / 2 };
}

function placeBpmnEdgeLabels(spec, paths, nodes, canvas) {
  const nodeById = new Map((spec.nodes || []).map((node) => [node.id, node]));
  const riskEdges = bpmnExceptionRouteEdges(spec);
  const labels = [];
  for (const edge of spec.edges || []) {
    if (!edge.label) continue;
    const gatewayBranch = nodeById.get(edge.from)?.type === "gateway";
    if (!gatewayBranch && !riskEdges.has(edge.id)) continue;
    const points = paths[edge.id] || [];
    if (points.length < 2) continue;
    const width = Math.min(126, Math.max(34, String(edge.label).length * 7 + 18));
    const height = 24;
    const segments = points.slice(0, -1)
      .map((start, index) => {
        const end = points[index + 1];
        return {
          start,
          end,
          length: Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
          sourceIndex: index,
        };
      })
      .filter((segment) => segment.length > 1)
      .sort((left, right) => right.length - left.length || left.sourceIndex - right.sourceIndex);
    const candidates = [];
    for (const [segmentRank, segment] of segments.entries()) {
      const vertical = Math.abs(segment.end.y - segment.start.y) > Math.abs(segment.end.x - segment.start.x);
      for (const [fractionRank, fraction] of [0.5, 0.3, 0.7].entries()) {
        const anchorX = segment.start.x + (segment.end.x - segment.start.x) * fraction;
        const anchorY = segment.start.y + (segment.end.y - segment.start.y) * fraction;
        for (const [offsetRank, offset] of [7, 35, 63].entries()) {
          if (vertical) {
            candidates.push({ x: anchorX + offset, y: anchorY - height / 2, w: width, h: height, rank: segmentRank * 20 + fractionRank * 4 + offsetRank });
            candidates.push({ x: anchorX - width - offset, y: anchorY - height / 2, w: width, h: height, rank: segmentRank * 20 + fractionRank * 4 + offsetRank + 1 });
          } else {
            candidates.push({ x: anchorX - width / 2, y: anchorY - height - offset, w: width, h: height, rank: segmentRank * 20 + fractionRank * 4 + offsetRank });
            candidates.push({ x: anchorX - width / 2, y: anchorY + offset, w: width, h: height, rank: segmentRank * 20 + fractionRank * 4 + offsetRank + 1 });
          }
        }
      }
    }
    const scored = candidates.map((candidate) => ({
      candidate,
      score: bpmnLabelCandidateScore(candidate, Object.values(nodes), labels, canvas),
    })).sort((left, right) => left.score - right.score || left.candidate.rank - right.candidate.rank);
    const selected = scored[0]?.candidate || { x: 4, y: 4, w: width, h: height };
    labels.push({
      id: edge.id,
      label: edge.label,
      role: riskEdges.has(edge.id) ? "risk" : "owned",
      x: Math.max(4, Math.min(canvas.width - width - 4, selected.x)),
      y: Math.max(4, Math.min(canvas.height - height - 4, selected.y)),
      w: width,
      h: height,
    });
  }
  return labels;
}

function bpmnLabelCandidateScore(candidate, nodeRects, placedLabels, canvas) {
  let score = candidate.rank || 0;
  if (candidate.x < 4 || candidate.y < 4 || candidate.x + candidate.w > canvas.width - 4 || candidate.y + candidate.h > canvas.height - 4) score += 1_000_000;
  for (const rect of nodeRects) if (rectsOverlap(candidate, rect, 4)) score += 100_000 + rectangleOverlapArea(candidate, rect);
  for (const label of placedLabels) if (rectsOverlap(candidate, label, 5)) score += 200_000 + rectangleOverlapArea(candidate, label);
  return score;
}

function rectangleOverlapArea(left, right) {
  const width = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
  return width * height;
}

function bpmnExceptionRouteEdges(spec) {
  const edges = spec.edges || [];
  const riskEdgeIds = new Set(edges.filter((edge) => edge.type === "exception" || edge.semanticRole === "risk").map((edge) => edge.id));
  const queue = edges.filter((edge) => riskEdgeIds.has(edge.id)).map((edge) => edge.to);
  const visited = new Set(queue);
  while (queue.length) {
    const nodeId = queue.shift();
    for (const edge of edges.filter((candidate) => candidate.from === nodeId)) {
      riskEdgeIds.add(edge.id);
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return riskEdgeIds;
}

export function layoutArchitecture(spec, canvas) {
  const nodes = {};
  // The proposal reference presents architecture as a centered vertical
  // stack. Keep layer metadata for semantic QA, but reserve a compact heading
  // band inside each layer instead of rendering a left-hand table column.
  const headingHeight = 28;
  const contentX = 150;
  const contentWidth = canvas.width - contentX * 2;
  const layerHeight = canvas.height / ARCHITECTURE_LAYER_DEFINITIONS.length;
  const architectureLayers = ARCHITECTURE_LAYER_DEFINITIONS.map((layer, index) => ({
    ...layer,
    x: 0,
    y: index * layerHeight,
    w: canvas.width,
    h: layerHeight,
  }));
  for (const layer of architectureLayers) {
    const layerNodes = (spec.nodes || []).filter((node) => architectureLayerIdForNode(node) === layer.id);
    placeArchitectureLayer(layerNodes, nodes, {
      x: contentX,
      y: layer.y + headingHeight,
      width: contentWidth,
      height: layer.h - headingHeight,
    });
  }
  const layout = buildLayout(spec, canvas, nodes);
  layout.edges = routeArchitectureEdges(spec, nodes, canvas, architectureLayers);
  layout.architectureLayers = architectureLayers;
  layout.architectureLegend = ARCHITECTURE_LAYER_DEFINITIONS.map((layer) => ({
    id: layer.id,
    key: layer.key,
    label: layer.label,
    nodeCount: (spec.nodes || []).filter((node) => architectureLayerIdForNode(node) === layer.id).length,
  }));
  return layout;
}

export function layoutGantt(spec, canvas) {
  const nodes = {};
  if (spec.variant === "pending") {
    placeQuestionGrid(spec.nodes, nodes, canvas);
    return buildLayout(spec, canvas, nodes);
  }
  if (spec.variant === "milestone") {
    const count = Math.max(1, spec.nodes.length);
    const available = canvas.width - 160;
    spec.nodes.forEach((node, index) => {
      const centerX = 80 + (count === 1 ? available / 2 : (index / (count - 1)) * available);
      nodes[node.id] = { x: Math.max(18, Math.min(canvas.width - 168, centerX - 75)), y: 190 + (index % 2) * 112, w: 150, h: 64 };
    });
    return buildLayout(spec, canvas, nodes);
  }
  const labelW = 300;
  const plotW = canvas.width - labelW - 40;
  const scale = spec.timeScale || {
    unit: spec.nodes.find((node) => node.time?.unit)?.time?.unit || "week",
    start: 1,
    end: Math.max(1, ...spec.nodes.map((node) => Number(node.time?.end || 1))),
  };
  spec.nodes.forEach((node, index) => {
    if (!node.time) throw Object.assign(new Error(`Gantt phase ${node.id} has no real span`), { code: "GANTT_PHASE_SPAN_MISSING", nodeId: node.id });
    const geometry = ganttBarGeometry(node.time, scale, labelW, plotW);
    nodes[node.id] = { x: geometry.x, y: 45 + index * 58, w: geometry.width, h: 38 };
  });
  return buildLayout(spec, canvas, nodes);
}

export function ganttBarGeometry(phaseTime, timeScale, plotX, plotWidth) {
  const scaleStart = Number(timeScale?.start ?? 1);
  const scaleEnd = Number(timeScale?.end ?? scaleStart);
  const start = Number(phaseTime?.start ?? scaleStart);
  const end = Number(phaseTime?.end ?? start);
  if (!Number.isFinite(scaleStart) || !Number.isFinite(scaleEnd) || !Number.isFinite(start) || !Number.isFinite(end) || scaleStart < 1 || scaleEnd < scaleStart || start < scaleStart || end > scaleEnd || end < start) {
    throw Object.assign(new Error("Invalid Gantt inclusive time geometry"), { code: "GANTT_TIME_GEOMETRY_INVALID" });
  }
  const scaleSpan = scaleEnd - scaleStart + 1;
  const barStartOffset = start - scaleStart;
  const barSpan = end - start + 1;
  return {
    x: plotX + (barStartOffset / scaleSpan) * plotWidth,
    width: (barSpan / scaleSpan) * plotWidth,
    scaleSpan,
    barStartOffset,
    barSpan,
  };
}

export function validateLayoutGeometry(layout) {
  const findings = [];
  const rects = Object.entries(layout.nodes || {});
  const canvasWidth = Number(layout.canvas?.width || 0);
  const canvasHeight = Number(layout.canvas?.height || 0);
  for (const [nodeId, rect] of rects) {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > canvasWidth || rect.y + rect.h > canvasHeight) findings.push({ code: "VIZ_NODE_OUT_OF_BOUNDS", nodeId });
  }
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i][1], rects[j][1], 8)) findings.push({ code: "VIZ_NODE_OVERLAP", nodes: [rects[i][0], rects[j][0]] });
    }
  }
  for (const [edgeId, points] of Object.entries(layout.edges || {})) {
    if (points.some((point) => point.x < 0 || point.y < 0 || point.x > canvasWidth || point.y > canvasHeight)) findings.push({ code: "VIZ_EDGE_OUT_OF_BOUNDS", edgeId });
    const endpoints = layout.edgeEndpoints?.[edgeId] || {};
    for (let index = 0; index < points.length - 1; index += 1) {
      const segment = [points[index], points[index + 1]];
      for (const [nodeId, rect] of rects) {
        if (nodeId === endpoints.from || nodeId === endpoints.to) continue;
        if (segmentIntersectsRect(segment, shrinkGeometryRect(rect, 2))) {
          findings.push({ code: "VIZ_EDGE_THROUGH_NODE", edgeId, nodeId });
        }
      }
    }
  }
  const edgeLabels = (Array.isArray(layout.bpmnEdgeLabels) ? layout.bpmnEdgeLabels : []).map((label) => [label.id, label]);
  for (const [edgeId, rect] of edgeLabels) {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > canvasWidth || rect.y + rect.h > canvasHeight) findings.push({ code: "VIZ_EDGE_LABEL_OUT_OF_BOUNDS", edgeId });
    for (const [nodeId, nodeRect] of rects) {
      if (rectsOverlap(rect, nodeRect, 2)) findings.push({ code: "VIZ_EDGE_LABEL_NODE_OVERLAP", edgeId, nodeId });
    }
  }
  for (let i = 0; i < edgeLabels.length; i += 1) {
    for (let j = i + 1; j < edgeLabels.length; j += 1) {
      if (rectsOverlap(edgeLabels[i][1], edgeLabels[j][1], 3)) findings.push({ code: "VIZ_EDGE_LABEL_OVERLAP", edges: [edgeLabels[i][0], edgeLabels[j][0]] });
    }
  }
  return { ok: findings.length === 0, findings };
}

export function rectPort(rect, side) {
  if (side === "left") return { x: rect.x, y: rect.y + rect.h / 2 };
  if (side === "right") return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
  if (side === "top") return { x: rect.x + rect.w / 2, y: rect.y };
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
}

export function orthogonalPath(sourcePoint, targetPoint) {
  const midX = (sourcePoint.x + targetPoint.x) / 2;
  return [sourcePoint, { x: midX, y: sourcePoint.y }, { x: midX, y: targetPoint.y }, targetPoint];
}

export function straightPath(sourcePoint, targetPoint) {
  return [sourcePoint, targetPoint];
}

export function routeBackEdge(sourceRect, targetRect, canvas) {
  const y = Math.max(16, Math.min(sourceRect.y, targetRect.y) - 36);
  return [rectPort(sourceRect, "top"), { x: sourceRect.x + sourceRect.w / 2, y }, { x: targetRect.x + targetRect.w / 2, y }, rectPort(targetRect, "top")];
}

export function segmentsIntersect(a, b) {
  const det = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return det(a[0], a[1], b[0]) * det(a[0], a[1], b[1]) <= 0 && det(b[0], b[1], a[0]) * det(b[0], b[1], a[1]) <= 0;
}

export function rectsOverlap(a, b, gap = 0) {
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
}

export function wrapLabel(text, { maxCharsPerLine = 18, maxLines = 4 } = {}) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxCharsPerLine && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function buildLayout(spec, canvas, nodes) {
  const edges = {};
  const edgeEndpoints = {};
  for (const edge of spec.edges || []) {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    if (!from || !to) continue;
    edgeEndpoints[edge.id] = { from: edge.from, to: edge.to };
    if (spec.kind === "nested_market" && spec.variant === "formula_pending" && edge.type === "association") {
      const source = rectPort(from, "top");
      const target = rectPort(to, "bottom");
      const railY = (source.y + target.y) / 2;
      edges[edge.id] = [source, { x: source.x, y: railY }, { x: target.x, y: railY }, target];
      continue;
    }
    if (spec.kind === "nested_market" && spec.variant === "numeric") {
      const source = rectPort(from, "bottom");
      const target = rectPort(to, "top");
      const railY = (source.y + target.y) / 2;
      edges[edge.id] = [source, { x: source.x, y: railY }, { x: target.x, y: railY }, target];
      continue;
    }
    if (spec.kind === "bpmn" && Math.abs((from.y + from.h / 2) - (to.y + to.h / 2)) > 24) {
      // Branches live below the primary process row. Route them through the
      // free vertical gutter between rows: a left/right center route can run
      // along the primary row and slice through every task between the two
      // endpoints (for example exception -> returns -> completed).
      const sourceBelowTarget = from.y + from.h / 2 > to.y + to.h / 2;
      const source = rectPort(from, sourceBelowTarget ? "top" : "bottom");
      const target = rectPort(to, sourceBelowTarget ? "bottom" : "top");
      const railY = (source.y + target.y) / 2;
      edges[edge.id] = [source, { x: source.x, y: railY }, { x: target.x, y: railY }, target];
      continue;
    }
    if (spec.kind === "ownership_boundary" && spec.nodes.find((node) => node.id === edge.from)?.type === "core") {
      const targetLeftOfCore = to.x + to.w / 2 < from.x + from.w / 2;
      const targetSide = targetLeftOfCore ? "right" : "left";
      const railX = targetLeftOfCore ? to.x + to.w + 18 : to.x - 18;
      const railY = from.y + from.h + 28;
      edges[edge.id] = [rectPort(from, "bottom"), { x: from.x + from.w / 2, y: railY }, { x: railX, y: railY }, { x: railX, y: to.y + to.h / 2 }, rectPort(to, targetSide)];
      continue;
    }
    if (spec.kind === "ownership_boundary") {
      const sourceNode = spec.nodes.find((node) => node.id === edge.from);
      const targetNode = spec.nodes.find((node) => node.id === edge.to);
      if (sourceNode?.semanticRole === "partner" && targetNode?.type === "core") {
        // Callback edges return around the outside/top of the ownership map.
        // A center-to-center orthogonal route cuts through the right-most
        // owned capability whenever two or more partner rails are present.
        const partnerNodes = spec.nodes.filter((node) => node.semanticRole === "partner");
        const partnerIndex = Math.max(0, partnerNodes.findIndex((node) => node.id === sourceNode.id));
        const railGap = Math.max(4, (to.y - 16) / (partnerNodes.length + 1));
        const railY = 8 + (partnerIndex + 1) * railGap;
        const targetX = to.x + ((partnerIndex + 1) / (partnerNodes.length + 1)) * to.w;
        const outerRailX = canvas.width - 10;
        edges[edge.id] = [
          rectPort(from, "right"),
          { x: outerRailX, y: from.y + from.h / 2 },
          { x: outerRailX, y: railY },
          { x: targetX, y: railY },
          { x: targetX, y: to.y },
        ];
        continue;
      }
    }
    if (spec.kind === "ownership_boundary" && edge.direction === "none" && from.y > to.y) {
      const railX = Math.max(24, Math.min(120, from.x - 120, to.x - 80));
      const railY = to.y + to.h + 34;
      edges[edge.id] = [rectPort(from, "left"), { x: railX, y: from.y + from.h / 2 }, { x: railX, y: railY }, { x: to.x + to.w / 2, y: railY }, rectPort(to, "bottom")];
      continue;
    }
    edges[edge.id] = orthogonalPath(rectPort(from, from.x < to.x ? "right" : "left"), rectPort(to, from.x < to.x ? "left" : "right"));
  }
  return { visualizationSpecId: spec.visualizationSpecId, kind: spec.kind, canvas, nodes, edges, edgeEndpoints, groups: layoutGroups(spec.groups || [], nodes, canvas) };
}

function shrinkGeometryRect(rect, px) {
  return { x: rect.x + px, y: rect.y + px, w: Math.max(0, rect.w - px * 2), h: Math.max(0, rect.h - px * 2) };
}

function segmentIntersectsRect(segment, rect) {
  const [a, b] = segment;
  const inside = (point) => point.x > rect.x && point.x < rect.x + rect.w && point.y > rect.y && point.y < rect.y + rect.h;
  if (inside(a) || inside(b)) return true;
  const edges = [
    [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }],
    [{ x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }],
    [{ x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }],
    [{ x: rect.x, y: rect.y + rect.h }, { x: rect.x, y: rect.y }],
  ];
  return edges.some((edge) => properSegmentsIntersect(a, b, edge[0], edge[1]));
}

function properSegmentsIntersect(a, b, c, d) {
  const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function layoutGroups(groups, nodes, canvas) {
  const result = {};
  for (const group of groups) {
    const rects = (group.nodeIds || []).map((id) => nodes[id]).filter(Boolean);
    if (!rects.length) continue;
    const minX = Math.max(0, Math.min(...rects.map((rect) => rect.x)) - 18);
    const minY = Math.max(0, Math.min(...rects.map((rect) => rect.y)) - 28);
    const maxX = Math.min(canvas.width, Math.max(...rects.map((rect) => rect.x + rect.w)) + 18);
    const maxY = Math.min(canvas.height, Math.max(...rects.map((rect) => rect.y + rect.h)) + 18);
    result[group.id] = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return result;
}

function placeQuestionGrid(items, nodes, canvas) {
  const columns = items.length > 2 ? 2 : 1;
  const width = Math.min(420, (canvas.width - 120 - (columns - 1) * 36) / columns);
  const rows = Math.ceil(items.length / columns);
  const startY = Math.max(42, (canvas.height - (rows * 92 + Math.max(0, rows - 1) * 28)) / 2);
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    nodes[item.id] = { x: 60 + column * (width + 36), y: startY + row * 120, w: width, h: 92 };
  });
}

function placeColumn(items, nodes, x, startY, width) {
  const gap = 22;
  items.forEach((item, index) => {
    nodes[item.id] = { x, y: startY + index * (72 + gap), w: width, h: 68 };
  });
}

function placeRow(items, nodes, startX, y, width) {
  items.forEach((item, index) => {
    nodes[item.id] = { x: startX + index * (width + 18), y, w: width, h: 58 };
  });
}

function placeGrid(items, nodes, startX, startY, width, rowHeight, columns) {
  items.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    nodes[item.id] = { x: startX + col * (width + 24), y: startY + row * rowHeight, w: width, h: 64 };
  });
}

function placeArchitectureLayer(items, nodes, area) {
  if (!items.length) return;
  const columns = Math.min(6, items.length);
  const rows = Math.ceil(items.length / columns);
  const gapX = 14;
  const gapY = 8;
  const innerHeight = Math.max(34, area.height - 24);
  const nodeHeight = Math.min(44, Math.max(32, (innerHeight - gapY * Math.max(0, rows - 1)) / rows));
  const totalHeight = rows * nodeHeight + Math.max(0, rows - 1) * gapY;
  const startY = area.y + (area.height - totalHeight) / 2;
  for (let row = 0; row < rows; row += 1) {
    const rowItems = items.slice(row * columns, (row + 1) * columns);
    const maxRowWidth = area.width - Math.max(0, rowItems.length - 1) * gapX;
    const naturalWidths = rowItems.map((item) => architectureNodeWidth(item));
    const naturalWidth = naturalWidths.reduce((sum, width) => sum + width, 0);
    const scale = naturalWidth > maxRowWidth ? maxRowWidth / naturalWidth : 1;
    const widths = naturalWidths.map((width) => Math.max(104, width * scale));
    const rowWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, rowItems.length - 1) * gapX;
    const startX = area.x + (area.width - rowWidth) / 2;
    let nodeX = startX;
    rowItems.forEach((item, column) => {
      const nodeWidth = widths[column];
      nodes[item.id] = {
        x: nodeX,
        y: startY + row * (nodeHeight + gapY),
        w: nodeWidth,
        h: nodeHeight,
      };
      nodeX += nodeWidth + gapX;
    });
  }
}

function architectureNodeWidth(item) {
  if (item?.type === "application") return 410;
  if (item?.type === "service") return 160;
  const labelLength = Array.from(String(item?.label || "")).length;
  return Math.min(270, Math.max(112, 34 + labelLength * 6.6));
}

function routeArchitectureEdges(spec, nodes, canvas, layers) {
  const paths = {};
  const layerIndex = new Map(layers.map((layer, index) => [layer.id, index]));
  const nodeById = new Map((spec.nodes || []).map((node) => [node.id, node]));
  for (const [edgeIndex, edge] of (spec.edges || []).entries()) {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    if (!from || !to) continue;
    const fromLayer = layerIndex.get(architectureLayerIdForNode(nodeById.get(edge.from)));
    const toLayer = layerIndex.get(architectureLayerIdForNode(nodeById.get(edge.to)));
    if (fromLayer === toLayer) {
      paths[edge.id] = orthogonalPath(rectPort(from, from.x < to.x ? "right" : "left"), rectPort(to, from.x < to.x ? "left" : "right"));
      continue;
    }
    const downward = Number(fromLayer) < Number(toLayer);
    const source = rectPort(from, downward ? "bottom" : "top");
    const target = rectPort(to, downward ? "top" : "bottom");
    if (Math.abs(Number(toLayer) - Number(fromLayer)) <= 1) {
      const railY = (source.y + target.y) / 2;
      paths[edge.id] = [source, { x: source.x, y: railY }, { x: target.x, y: railY }, target];
      continue;
    }
    const railX = canvas.width - 12 - (edgeIndex % 3) * 5;
    const sourceRailY = source.y + (downward ? 10 : -10);
    const targetRailY = target.y + (downward ? -10 : 10);
    paths[edge.id] = [
      source,
      { x: source.x, y: sourceRailY },
      { x: railX, y: sourceRailY },
      { x: railX, y: targetRailY },
      { x: target.x, y: targetRailY },
      target,
    ];
  }
  return paths;
}

function layoutTreeSide(branchModels, nodes, canvas, { branchX, childX, width }) {
  if (!branchModels.length) return;
  const slotCount = branchModels.reduce((total, model) => total + Math.max(1, model.children.length), 0);
  const top = 30;
  const usableHeight = Math.max(1, canvas.height - top * 2);
  const slotHeight = usableHeight / Math.max(1, slotCount);
  const nodeHeight = Math.min(62, Math.max(28, slotHeight - 10));
  let slotIndex = 0;
  for (const model of branchModels) {
    const slotSpan = Math.max(1, model.children.length);
    const centers = [];
    for (const child of model.children) {
      const centerY = top + slotHeight * (slotIndex + 0.5);
      centers.push(centerY);
      nodes[child.id] = { x: childX, y: centerY - nodeHeight / 2, w: width, h: nodeHeight };
      slotIndex += 1;
    }
    if (!centers.length) {
      centers.push(top + slotHeight * (slotIndex + 0.5));
      slotIndex += slotSpan;
    }
    const branchCenter = centers.reduce((sum, value) => sum + value, 0) / centers.length;
    nodes[model.branch.id] = { x: branchX, y: branchCenter - nodeHeight / 2, w: width, h: nodeHeight };
  }
}
