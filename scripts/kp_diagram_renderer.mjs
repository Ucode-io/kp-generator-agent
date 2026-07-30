import { escapeHtmlAttribute, escapeHtmlText, safeDomId } from "./kp_render_safety.mjs";
import { formatRendererUnit, localizeRendererText, normalizeRendererLocale, rendererTimePrefix } from "./kp_pdf_reference_locale.mjs";
import { ARCHITECTURE_LAYER_DEFINITIONS } from "./kp_architecture_layers.mjs";

const FACTUAL_TRUTH_STATUSES = new Set(["explicit", "verified", "single_source"]);

export function visualizationStyles(styleProfile = {}) {
  const canvas = styleProfile.canvas || {};
  const accents = styleProfile.accents || {};
  return {
    background: canvas.surface1 || "#17141F",
    text: canvas.textPrimary || "#F2EFE6",
    muted: canvas.textSecondary || "#A39CAD",
    rule: canvas.rule || "#342D42",
    owned: accents.primary || "#7C5CFF",
    // Text-bearing "owned" elements (edge labels) need the contrast-safe
    // accent: the vivid decorative accent may sit below 4.5:1 on the canvas.
    ownedLabel: accents.secondary || accents.primary || "#7C5CFF",
    secondary: accents.secondary || accents.primary || "#A78BFA",
    partner: accents.warning || "#D9A94E",
    deferred: accents.critical || "#F0705A",
    risk: accents.critical || "#F0705A",
    positive: accents.positive || "#4ED9A4",
    neutral: canvas.textSecondary || "#A39CAD",
  };
}

export function renderVisualization(spec, layout, styleProfile = {}, { locale = "en" } = {}) {
  const normalizedLocale = normalizeRendererLocale(locale);
  const s = visualizationStyles(styleProfile);
  const markerId = `arrow-${safeDomId(spec.visualizationSpecId)}`;
  const ganttGuides = renderGanttGuides(spec, layout, normalizedLocale);
  const dominantTruthStatus = dominantRepeatedTruthStatus(spec.nodes || []);
  const bpmnRiskEdges = spec.kind === "bpmn" ? bpmnExceptionRouteEdgeIds(spec) : new Set();
  const bpmnRiskNodes = new Set((spec.edges || [])
    .filter((edge) => bpmnRiskEdges.has(edge.id))
    .map((edge) => spec.nodes.find((node) => node.id === edge.to))
    .filter((node) => node && node.type !== "end_event")
    .map((node) => node.id));
  const mindMap = spec.kind === "hub_spoke" ? hubSpokeBranchModel(spec, s) : null;
  const nodeHtml = (spec.nodes || []).map((node) => {
    const rect = layout.nodes[node.id] || { x: 0, y: 0, w: 160, h: 60 };
    const color = spec.kind === "bpmn" && bpmnRiskNodes.has(node.id)
      ? s.risk
      : mindMap
      ? mindMap.colorFor(node.id)
      : s[node.semanticRole] || s.neutral;
    const border = spec.kind === "hub_spoke" || spec.kind === "bpmn"
      ? "solid"
      : node.truthStatus === "explicit" || node.truthStatus === "verified" ? "solid" : node.truthStatus === "inferred" ? "dotted" : "dashed";
    const statusBadge = spec.kind === "bpmn" || node.truthStatus === dominantTruthStatus ? "" : badge(node.truthStatus, normalizedLocale);
    const nodeClass = [
      "viz-node",
      spec.kind === "architecture" ? "viz-architecture-node" : "",
      spec.kind === "hub_spoke" ? "viz-mindmap-node" : "",
      spec.kind === "hub_spoke" ? `viz-node-${safeDomId(node.type)}` : "",
      spec.kind === "bpmn" ? "viz-bpmn-node" : "",
      spec.kind === "bpmn" ? `viz-node-${safeDomId(node.type)}` : "",
      spec.kind === "bpmn" && bpmnRiskNodes.has(node.id) ? "viz-bpmn-node-risk" : "",
    ].filter(Boolean).join(" ");
    const branchAttribute = mindMap ? ` data-branch-index="${mindMap.branchIndexFor(node.id)}"` : "";
    const tintVariables = mindMap ? `;--viz-node-tint:${hexAlpha(color, 0.13)};--viz-node-soft:${hexAlpha(color, 0.42)}` : "";
    return `<div class="${nodeClass}" data-geometry-role="semantic_node" data-node-id="${escapeHtmlAttribute(node.id)}" data-node-type="${escapeHtmlAttribute(node.type)}" data-semantic-role="${escapeHtmlAttribute(node.semanticRole)}" data-group-id="${escapeHtmlAttribute(node.groupId || "")}" data-lane="${escapeHtmlAttribute(node.lane || "")}" data-truth-status="${escapeHtmlAttribute(node.truthStatus)}" data-inclusion="${escapeHtmlAttribute(node.inclusion)}"${branchAttribute}${factualSourceIdsAttribute(node)} style="left:${finite(rect.x)}px;top:${finite(rect.y)}px;width:${finite(rect.w)}px;height:${finite(rect.h)}px;border-color:${color};border-style:${border};--viz-node-color:${color}${tintVariables}"><span>${escapeHtmlText(node.label)}</span>${statusBadge}</div>`;
  }).join("");
  const edgeHtml = (spec.edges || []).map((edge) => {
    const points = layout.edges[edge.id] || [];
    const d = mindMap
      ? roundedOrthogonalPathD(points)
      : points.map((point, index) => `${index ? "L" : "M"}${finite(point.x)},${finite(point.y)}`).join(" ");
    const role = spec.kind === "bpmn" ? bpmnEdgeRole(edge, spec, bpmnRiskEdges) : architectureEdgeRole(edge);
    const edgeMarkerId = ["architecture", "bpmn"].includes(spec.kind) ? `${markerId}-${role}` : markerId;
    const marker = edge.direction === "none" || spec.kind === "hub_spoke" ? "" : ` marker-end="url(#${edgeMarkerId})"`;
    const stroke = spec.kind === "bpmn"
      ? semanticRoleColor(role, s)
      : spec.kind === "architecture"
        ? architectureRoleColor(role, s)
        : mindMap
          ? hexAlpha(mindMap.colorFor(edge.to), mindMap.isRootEdge(edge) ? 0.85 : 0.55)
          : s.rule;
    const strokeWidth = mindMap ? (mindMap.isRootEdge(edge) ? 2.6 : 1.8) : 2;
    return `<path class="viz-edge viz-edge-${safeDomId(role)}" data-geometry-role="edge" data-edge-id="${escapeHtmlAttribute(edge.id)}" data-edge-from="${escapeHtmlAttribute(edge.from)}" data-edge-to="${escapeHtmlAttribute(edge.to)}" data-truth-status="${escapeHtmlAttribute(edge.truthStatus)}"${factualSourceIdsAttribute(edge)} d="${escapeHtmlAttribute(d)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${marker}></path>`;
  }).join("");
  const markerDefs = spec.kind === "architecture"
    ? ["owned", "partner", "neutral"].map((role) => `<marker id="${markerId}-${role}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${architectureRoleColor(role, s)}"></path></marker>`).join("")
    : spec.kind === "bpmn"
      ? ["owned", "partner", "risk", "positive", "neutral"].map((role) => `<marker id="${markerId}-${role}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${semanticRoleColor(role, s)}"></path></marker>`).join("")
      : `<marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${s.rule}"></path></marker>`;
  const architectureScaffold = spec.kind === "architecture" ? renderArchitectureScaffold(layout, normalizedLocale, s) : "";
  const bpmnScaffold = spec.kind === "bpmn" ? renderBpmnScaffold(layout, s) : "";
  const bpmnEdgeLabels = spec.kind === "bpmn" ? renderBpmnEdgeLabels(layout, s) : "";
  // A full 12-function decomposition stays on one page: past 8 terminal rows
  // the mind map switches to a compact (zoomed-out) type scale.
  const mindMapTerminalRows = spec.kind === "hub_spoke"
    ? spec.nodes.filter((node) => node.type === "subfunction").length
      + spec.nodes.filter((node) => node.type === "capability" && !(spec.edges || []).some((edge) => edge.from === node.id)).length
    : 0;
  const mindMapDense = spec.kind === "hub_spoke" && mindMapTerminalRows > 8;
  const canvasClass = [
    "viz-canvas",
    spec.kind === "architecture" ? "viz-architecture" : "",
    spec.kind === "hub_spoke" ? "viz-mindmap" : "",
    mindMapDense ? "viz-mindmap-dense" : "",
    spec.kind === "bpmn" ? "viz-bpmn" : "",
  ].filter(Boolean).join(" ");
  return `<div class="${canvasClass}" data-viz-id="${escapeHtmlAttribute(spec.visualizationSpecId)}" data-viz-kind="${escapeHtmlAttribute(spec.kind)}" data-viz-variant="${escapeHtmlAttribute(spec.variant)}"${mindMapDense ? ' data-viz-density="dense"' : ""} data-data-state="${escapeHtmlAttribute(spec.dataState)}" style="width:${finite(layout.canvas.width)}px;height:${finite(layout.canvas.height)}px;background:${s.background};color:${s.text}">
    <div class="viz-groups">${architectureScaffold}${bpmnScaffold}</div>
    ${ganttGuides}
    <svg class="viz-edges" viewBox="0 0 ${finite(layout.canvas.width)} ${finite(layout.canvas.height)}" width="${finite(layout.canvas.width)}" height="${finite(layout.canvas.height)}">
      <defs>${markerDefs}</defs>
      ${edgeHtml}
    </svg>
    <div class="viz-edge-labels">${bpmnEdgeLabels}</div>
    <div class="viz-nodes">${nodeHtml}</div>
  </div>`;
}

// The mind map reads as an infographic: every domain branch and all of its
// descendants share one accent color, and connectors flow with rounded
// corners in the branch color instead of a uniform grey tree.
function hubSpokeBranchModel(spec, styles) {
  const branchPalette = [styles.owned, styles.positive, styles.partner, styles.secondary, styles.deferred];
  const root = (spec.nodes || []).find((node) => node.type === "core") || (spec.nodes || [])[0] || null;
  const parentByNode = new Map();
  for (const edge of spec.edges || []) {
    if (!parentByNode.has(edge.to)) parentByNode.set(edge.to, edge.from);
  }
  const branchOrder = (spec.edges || []).filter((edge) => edge.from === root?.id).map((edge) => edge.to);
  const branchIndexByNode = new Map();
  const branchOf = (nodeId, depth = 0) => {
    if (!root || nodeId === root.id || depth > 12) return -1;
    if (branchIndexByNode.has(nodeId)) return branchIndexByNode.get(nodeId);
    const direct = branchOrder.indexOf(nodeId);
    const resolved = direct >= 0 ? direct : branchOf(parentByNode.get(nodeId), depth + 1);
    branchIndexByNode.set(nodeId, resolved);
    return resolved;
  };
  for (const node of spec.nodes || []) branchOf(node.id);
  return {
    branchIndexFor: (nodeId) => Math.max(-1, branchOf(nodeId)),
    colorFor: (nodeId) => {
      if (root && nodeId === root.id) return styles.owned;
      const index = branchOf(nodeId);
      return index >= 0 ? branchPalette[index % branchPalette.length] : styles.neutral;
    },
    isRootEdge: (edge) => Boolean(root && edge.from === root.id),
  };
}

function roundedOrthogonalPathD(points = [], radius = 10) {
  if (points.length < 2) return "";
  if (points.length === 2) return `M${finite(points[0].x)},${finite(points[0].y)} L${finite(points[1].x)},${finite(points[1].y)}`;
  const segments = [`M${finite(points[0].x)},${finite(points[0].y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const trim = Math.min(radius, inLength / 2, outLength / 2);
    if (trim < 1) {
      segments.push(`L${finite(corner.x)},${finite(corner.y)}`);
      continue;
    }
    const entry = {
      x: corner.x - ((corner.x - previous.x) / (inLength || 1)) * trim,
      y: corner.y - ((corner.y - previous.y) / (inLength || 1)) * trim,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / (outLength || 1)) * trim,
      y: corner.y + ((next.y - corner.y) / (outLength || 1)) * trim,
    };
    segments.push(`L${finite(entry.x)},${finite(entry.y)}`);
    segments.push(`Q${finite(corner.x)},${finite(corner.y)} ${finite(exit.x)},${finite(exit.y)}`);
  }
  const last = points[points.length - 1];
  segments.push(`L${finite(last.x)},${finite(last.y)}`);
  return segments.join(" ");
}

function hexAlpha(color = "", alpha = 1) {
  const match = String(color).trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return color;
  const bounded = Math.max(0, Math.min(1, Number(alpha)));
  return `#${match[1]}${Math.round(bounded * 255).toString(16).padStart(2, "0").toUpperCase()}`;
}

function renderBpmnScaffold(layout, styles) {
  const lanes = (layout.bpmnLanes || []).map((lane, index) => {
    const color = semanticRoleColor(lane.semanticRole || "owned", styles);
    return `<div class="viz-bpmn-lane" data-lane-id="${escapeHtmlAttribute(lane.id)}" data-semantic-role="${escapeHtmlAttribute(lane.semanticRole || "owned")}" style="left:${finite(lane.x)}px;top:${finite(lane.y)}px;width:${finite(lane.w)}px;height:${finite(lane.h)}px;--viz-lane-color:${color};--viz-lane-label-width:${finite(lane.labelWidth || 128)}px"><span class="viz-bpmn-lane-label"><small>${String(index + 1).padStart(2, "0")}</small><strong>${escapeHtmlText(lane.label)}</strong></span></div>`;
  }).join("");
  return `<div class="viz-bpmn-lanes">${lanes}</div>`;
}

function renderBpmnEdgeLabels(layout, styles) {
  return (layout.bpmnEdgeLabels || []).map((item) => {
    const color = (item.role || "owned") === "owned"
      ? styles.ownedLabel || styles.owned
      : semanticRoleColor(item.role || "owned", styles);
    return `<span class="viz-bpmn-edge-label viz-bpmn-edge-label-${safeDomId(item.role || "owned")}" data-edge-id="${escapeHtmlAttribute(item.id)}" style="left:${finite(item.x)}px;top:${finite(item.y)}px;width:${finite(item.w)}px;height:${finite(item.h)}px;border-color:${color};color:${color}">${escapeHtmlText(item.label)}</span>`;
  }).join("");
}

function renderArchitectureScaffold(layout, locale, styles) {
  const copy = architectureCopy(locale);
  const colorByLayer = {
    users: styles.neutral,
    platforms: styles.owned,
    backend: styles.secondary,
    data: styles.positive,
    integrations: styles.partner,
  };
  const legend = (layout.architectureLegend || ARCHITECTURE_LAYER_DEFINITIONS).map((item, index) => `<span class="viz-architecture-legend-item" style="border-color:${colorByLayer[item.key] || styles.rule}"><small>${String(index + 1).padStart(2, "0")}</small><strong>${escapeHtmlText(copy.layers[item.key] || item.label)}</strong></span>`).join("");
  const layers = (layout.architectureLayers || []).map((layer, index) => `<div class="viz-architecture-layer" style="top:${finite(layer.y)}px;width:${finite(layer.w)}px;height:${finite(layer.h)}px"><span class="viz-architecture-layer-label"><small>${String(index + 1).padStart(2, "0")}</small><strong>${escapeHtmlText(copy.layers[layer.key] || layer.label)}</strong></span></div>`).join("");
  return `<div class="viz-architecture-legend"><span class="viz-architecture-legend-title"><small>${escapeHtmlText(copy.legend)}</small><strong>${escapeHtmlText(copy.stack)}</strong></span>${legend}</div><div class="viz-architecture-layers">${layers}</div>`;
}

function architectureCopy(locale) {
  if (locale === "ru-RU") return {
    legend: "СОСТАВ СХЕМЫ",
    stack: "5 уровней системы",
    layers: { users: "Типы пользователей", platforms: "Пользовательские интерфейсы", backend: "Серверная часть", data: "Базы данных", integrations: "Интеграции" },
  };
  if (locale === "uz-Latn") return {
    legend: "SXEMA TARKIBI",
    stack: "Tizimning 5 qatlami",
    layers: { users: "Foydalanuvchi turlari", platforms: "Foydalanuvchi platformalari", backend: "Server qismi", data: "Ma’lumotlar bazalari", integrations: "Integratsiyalar" },
  };
  return {
    legend: "SYSTEM MAP",
    stack: "5-layer architecture",
    layers: { users: "User types", platforms: "User platforms", backend: "Backend", data: "Databases", integrations: "Integrations" },
  };
}

function architectureEdgeRole(edge = {}) {
  return edge.semanticRole === "partner" ? "partner" : edge.semanticRole === "owned" ? "owned" : "neutral";
}

function architectureRoleColor(role, styles) {
  return role === "partner" ? styles.partner : role === "owned" ? styles.owned : styles.rule;
}

function semanticRoleColor(role, styles) {
  return styles[role] || styles.rule;
}

function bpmnExceptionRouteEdgeIds(spec) {
  const edges = spec.edges || [];
  const ids = new Set(edges.filter((edge) => edge.type === "exception" || edge.semanticRole === "risk").map((edge) => edge.id));
  const queue = edges.filter((edge) => ids.has(edge.id)).map((edge) => edge.to);
  const visited = new Set(queue);
  while (queue.length) {
    const nodeId = queue.shift();
    for (const edge of edges.filter((candidate) => candidate.from === nodeId)) {
      ids.add(edge.id);
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return ids;
}

function bpmnEdgeRole(edge, spec, riskEdges) {
  if (riskEdges.has(edge.id)) return "risk";
  const target = (spec.nodes || []).find((node) => node.id === edge.to);
  if (target?.semanticRole === "positive" || target?.type === "end_event") return "positive";
  if (edge.semanticRole === "partner") return "partner";
  return "owned";
}

function dominantRepeatedTruthStatus(nodes = []) {
  if (nodes.length < 3) return null;
  const counts = new Map();
  for (const node of nodes) {
    const status = String(node?.truthStatus || "").trim();
    if (!status || !badge(status, "en")) continue;
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  const dominant = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return dominant && dominant[1] >= 3 && dominant[1] / nodes.length >= 0.6 ? dominant[0] : null;
}

function renderGanttGuides(spec, layout, locale) {
  if (spec.kind !== "gantt" || spec.variant !== "gantt" || !spec.timeScale || !(spec.nodes || []).length) return "";
  const scaleStart = Number(spec.timeScale.start);
  const scaleEnd = Number(spec.timeScale.end);
  const unitCount = scaleEnd - scaleStart + 1;
  const anchor = (spec.nodes || []).find((node) => node.time && layout.nodes?.[node.id]);
  if (!anchor || !Number.isInteger(scaleStart) || !Number.isInteger(scaleEnd) || unitCount < 1) return "";
  const anchorRect = layout.nodes[anchor.id];
  const anchorSpan = Number(anchor.time.end) - Number(anchor.time.start) + 1;
  const unitWidth = Number(anchorRect.w) / anchorSpan;
  const plotX = Number(anchorRect.x) - (Number(anchor.time.start) - scaleStart) * unitWidth;
  const plotWidth = unitWidth * unitCount;
  const tickStride = Math.max(1, Math.ceil(unitCount / 18));
  const ticks = [];
  for (let value = scaleStart; value <= scaleEnd; value += 1) {
    if ((value - scaleStart) % tickStride !== 0 && value !== scaleEnd) continue;
    const offset = value - scaleStart;
    ticks.push(`<span style="left:${finite(plotX + offset * unitWidth)}px;width:${finite(unitWidth * Math.min(tickStride, scaleEnd - value + 1))}px">${escapeHtmlText(timeTickLabel(spec.timeScale.unit, value, locale))}</span>`);
  }
  const gridBoundaries = [];
  for (let offset = 0; offset <= unitCount; offset += tickStride) {
    gridBoundaries.push(`<span style="left:${finite(plotX + Math.min(offset, unitCount) * unitWidth)}px;height:${finite(layout.canvas.height - 52)}px"></span>`);
  }
  if (unitCount % tickStride !== 0) {
    gridBoundaries.push(`<span style="left:${finite(plotX + plotWidth)}px;height:${finite(layout.canvas.height - 52)}px"></span>`);
  }
  const phaseLabels = (spec.nodes || []).map((node) => {
    const rect = layout.nodes?.[node.id];
    if (!rect || !node.time) return "";
    const start = Number(node.time.start);
    const end = Number(node.time.end);
    const duration = end - start + 1;
    return `<div class="viz-gantt-label" style="left:18px;top:${finite(rect.y)}px;width:${finite(Math.max(120, plotX - 34))}px;height:${finite(rect.h)}px"><strong>${escapeHtmlText(node.label)}</strong><small>${escapeHtmlText(timeRangeLabel(spec.timeScale.unit, start, end, duration, locale))}</small></div>`;
  }).join("");
  return `<div class="viz-gantt-grid">${gridBoundaries.join("")}</div><div class="viz-gantt-axis">${ticks.join("")}</div><div class="viz-gantt-labels">${phaseLabels}</div>`;
}

function timeTickLabel(unit, value, locale) {
  const prefix = rendererTimePrefix(unit, locale);
  return `${prefix}${value}`;
}

function timeRangeLabel(unit, start, end, duration, locale) {
  const range = start === end ? timeTickLabel(unit, start, locale) : `${timeTickLabel(unit, start, locale)}–${timeTickLabel(unit, end, locale)}`;
  return `${range} · ${formatRendererUnit(duration, unit, locale)}`;
}

function badge(truthStatus, locale) {
  const map = { recommended: "Proposed", inferred: "Inferred", assumed: "Assumption", unknown: "To confirm", single_source: "Single source" };
  for (const key of Object.keys(map)) map[key] = localizeRendererText(map[key], locale);
  return map[truthStatus] ? `<small>${escapeHtmlText(map[truthStatus])}</small>` : "";
}

function finite(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw Object.assign(new Error("Non-finite diagram geometry"), { code: "VIZ_GEOMETRY_NONFINITE" });
  return Number(number.toFixed(3));
}

function factualSourceIdsAttribute(value = {}) {
  if (!FACTUAL_TRUTH_STATUSES.has(String(value.truthStatus || ""))) return "";
  const sourceIds = [...new Set((Array.isArray(value.sourceIds) ? value.sourceIds : [])
    .map((sourceId) => String(sourceId).normalize("NFC").trim())
    .filter(Boolean))];
  if (!sourceIds.length) return "";
  return ` data-source-ids="${escapeHtmlAttribute(JSON.stringify(sourceIds))}"`;
}
