// Keep each product-map page inside both the renderer's readable-density
// budget and the DOM QA contract. Larger maps continue on another page.
const DEFAULT_MAX_VISIBLE_NODES = 30;
const DEFAULT_MAX_TERMINAL_ROWS = 13;

export function buildProductMapModel(semanticModel = {}) {
  const scope = rows(semanticModel?.scopeItems?.length ? semanticModel.scopeItems : semanticModel?.scope?.scopeItems);
  const capabilities = rows(semanticModel?.capabilities?.length ? semanticModel.capabilities : semanticModel?.scope?.capabilities);
  const capabilityById = new Map(capabilities.map((row) => [row.id, row]));
  const branchesByLabel = new Map();

  for (const [scopeIndex, item] of scope.entries()) {
    const linked = rows(item.capabilityIds).map((id) => capabilityById.get(id)).filter(Boolean);
    const functionRows = linked.length ? linked : [item];
    const functions = functionRows.map((entity, entityIndex) => ({
      ...entity,
      id: entity.id || item.id || `FUNCTION-${scopeIndex + 1}-${entityIndex + 1}`,
      label: cleanText(item.feature || item.label || entityLabel(entity), 80),
      detail: productDetail(item, entity),
      inclusion: item.inclusion || entity.inclusion,
      truthStatus: entity.truthStatus || item.truthStatus,
      sourceIds: unique([...rows(entity.sourceIds), ...rows(item.sourceIds)].map(String).filter(Boolean)),
      derivationRuleId: entity.derivationRuleId || item.derivationRuleId || null,
      dataRef: linked.length ? `/capabilities/${capabilities.indexOf(entity)}` : `/scopeItems/${scopeIndex}`,
      detailDataRef: `/scopeItems/${scopeIndex}/detail`,
      sourceEntityIds: unique([item.id, entity.id].filter(Boolean).map(String)),
    }));
    const epic = cleanOptionalText(item.epic, 80);
    const genericEpic = !epic || /^(scope|product|features?|module)$/iu.test(epic);
    const label = genericEpic ? functions[0].label : epic;
    const key = normalizeLabel(label);
    const existing = branchesByLabel.get(key) || {
      id: item.id || `BRANCH-${scopeIndex + 1}`,
      label,
      functions: [],
      sourceRows: [],
    };
    existing.functions.push(...functions);
    existing.sourceRows.push(item);
    branchesByLabel.set(key, existing);
  }

  if (!scope.length) {
    for (const [index, capability] of capabilities.entries()) {
      const label = entityLabel(capability);
      branchesByLabel.set(`cap-${safeId(capability.id || index + 1)}`, {
        id: capability.id || `BRANCH-${index + 1}`,
        label,
        functions: [{
          ...capability,
          id: capability.id || `FUNCTION-${index + 1}`,
          label,
          detail: "",
          dataRef: `/capabilities/${index}`,
          detailDataRef: null,
          sourceEntityIds: [capability.id].filter(Boolean).map(String),
        }],
        sourceRows: [capability],
      });
    }
  }

  const branches = [...branchesByLabel.values()].map((branch) => ({
    ...branch,
    functions: uniqueFunctions(branch.functions),
  }));
  return {
    root: semanticModel?.project || {},
    branches,
  };
}

export function buildProductMapSegments(semanticModel = {}, options = {}) {
  const maxVisibleNodes = positiveInteger(options.maxVisibleNodes, DEFAULT_MAX_VISIBLE_NODES);
  const maxTerminalRows = positiveInteger(options.maxTerminalRows, DEFAULT_MAX_TERMINAL_ROWS);
  const model = buildProductMapModel(semanticModel);
  if (model.branches.length < 2) {
    return [{ segmentIndex: 1, segmentCount: 1, root: model.root, branches: model.branches }];
  }

  const chunks = model.branches.flatMap((branch) => splitBranch(branch, { maxVisibleNodes, maxTerminalRows }));
  const grouped = [];
  let current = [];
  for (const chunk of chunks) {
    const candidate = [...current, chunk];
    if (current.length && !segmentFits(candidate, { maxVisibleNodes, maxTerminalRows })) {
      grouped.push(current);
      current = [chunk];
    } else {
      current = candidate;
    }
  }
  if (current.length) grouped.push(current);
  const segmentCount = Math.max(1, grouped.length);
  return grouped.map((branches, index) => ({
    segmentIndex: index + 1,
    segmentCount,
    root: model.root,
    branches,
  }));
}

export function productMapSegmentCount(semanticModel = {}, options = {}) {
  return buildProductMapSegments(semanticModel, options).length;
}

function splitBranch(branch, limits) {
  const chunks = [];
  let current = [];
  for (const item of branch.functions) {
    const candidate = [...current, item];
    if (current.length && !segmentFits([{ ...branch, functions: candidate }], limits)) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);
  return chunks.map((functions, index) => ({
    ...branch,
    functions,
    continuationIndex: index + 1,
    continuationCount: chunks.length,
  }));
}

function segmentFits(branches, { maxVisibleNodes, maxTerminalRows }) {
  const terminalRows = branches.reduce((sum, branch) => sum + branch.functions.reduce((branchSum, item) => branchSum + Math.max(1, rows(item.details).length), 0), 0);
  const nodes = 1 + branches.length + branches.reduce((sum, branch) => sum + branch.functions.reduce((branchSum, item) => branchSum + 1 + rows(item.details).length, 0), 0);
  return terminalRows <= maxTerminalRows && nodes <= maxVisibleNodes;
}

function productDetail(scopeItem, entity) {
  const detail = cleanOptionalText(scopeItem?.detail || scopeItem?.description, 80);
  if (!detail) return "";
  const labels = [entityLabel(entity), scopeItem?.label, scopeItem?.feature].map(normalizeLabel).filter(Boolean);
  return labels.includes(normalizeLabel(detail)) ? "" : detail;
}

function uniqueFunctions(items) {
  const grouped = new Map();
  const output = [];
  for (const item of items) {
    const key = normalizeLabel(item?.label) || String(item?.id || output.length + 1);
    const detail = item.detail ? {
      id: `${item.id || "FUNCTION"}-DETAIL`,
      label: item.detail,
      truthStatus: item.truthStatus,
      inclusion: item.inclusion,
      sourceIds: rows(item.sourceIds),
      derivationRuleId: item.derivationRuleId || null,
      dataRef: item.detailDataRef || null,
      sourceEntityIds: rows(item.sourceEntityIds),
    } : null;
    const existing = grouped.get(key);
    if (!existing) {
      const created = { ...item, details: detail ? [detail] : [] };
      delete created.detail;
      grouped.set(key, created);
      output.push(created);
      continue;
    }
    existing.sourceIds = unique([...rows(existing.sourceIds), ...rows(item.sourceIds)].map(String).filter(Boolean));
    existing.sourceEntityIds = unique([...rows(existing.sourceEntityIds), ...rows(item.sourceEntityIds)].map(String).filter(Boolean));
    existing.truthStatus = conservativeTruth(existing.truthStatus, item.truthStatus);
    if (detail && !existing.details.some((row) => normalizeLabel(row.label) === normalizeLabel(detail.label))) existing.details.push(detail);
  }
  return output;
}

function conservativeTruth(left, right) {
  const order = ["unknown", "assumed", "inferred", "recommended", "single_source", "verified", "explicit"];
  const values = [left, right].map((value) => order.indexOf(value)).filter((value) => value >= 0);
  return values.length ? order[Math.min(...values)] : left || right;
}

function entityLabel(entity) {
  return cleanText(entity?.label || entity?.feature || entity?.name || entity?.id || "To confirm", 80);
}

function cleanText(value, maxLength) {
  const normalized = String(value ?? "").normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "To confirm";
  const points = [...normalized];
  return points.length <= maxLength ? normalized : `${points.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function cleanOptionalText(value, maxLength) {
  const normalized = String(value ?? "").normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const points = [...normalized];
  return points.length <= maxLength ? normalized : `${points.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function normalizeLabel(value) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function safeId(value) {
  return String(value ?? "UNKNOWN").normalize("NFC").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "UNKNOWN";
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values)];
}
