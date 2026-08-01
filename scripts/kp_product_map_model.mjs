// The expanded 1296 x 646 product-map canvas can carry up to 16 terminal
// rows at the renderer's 11 px dense type scale. These limits mirror the
// browser DOM quality gate; larger maps continue on another page instead of
// shrinking below the readability floor.
export const PRODUCT_MAP_PAGE_LIMITS = Object.freeze({
  maxVisibleNodes: 42,
  maxTerminalRows: 16,
  maxBranches: 8,
});

export function buildProductMapModel(semanticModel = {}) {
  const scope = rows(semanticModel?.scopeItems?.length ? semanticModel.scopeItems : semanticModel?.scope?.scopeItems);
  const capabilities = rows(semanticModel?.capabilities?.length ? semanticModel.capabilities : semanticModel?.scope?.capabilities);
  const capabilityById = new Map(capabilities.map((row) => [row.id, row]));
  const branchesByLabel = new Map();

  for (const [scopeIndex, item] of scope.entries()) {
    const linked = rows(item.capabilityIds).map((id) => capabilityById.get(id)).filter(Boolean);
    const functionRows = linked.length ? linked : [item];
    const functions = functionRows.map((entity, entityIndex) => {
      const id = entity.id || item.id || `FUNCTION-${scopeIndex + 1}-${entityIndex + 1}`;
      const label = cleanText(item.feature || item.label || entityLabel(entity), 80);
      const metadata = {
        id,
        label,
        deadline: cleanOptionalText(item.phase || item.deadline || item.deliveryWindow, 70),
        phase: cleanOptionalText(item.phase || item.deadline || item.deliveryWindow, 70),
        inclusion: item.inclusion || entity.inclusion,
        truthStatus: entity.truthStatus || item.truthStatus,
        sourceIds: unique([...rows(entity.sourceIds), ...rows(item.sourceIds)].map(String).filter(Boolean)),
        derivationRuleId: entity.derivationRuleId || item.derivationRuleId || null,
        dataRef: linked.length ? `/capabilities/${capabilities.indexOf(entity)}` : `/scopeItems/${scopeIndex}`,
        detailDataRef: `/scopeItems/${scopeIndex}/detail`,
        sourceEntityIds: unique([item.id, entity.id].filter(Boolean).map(String)),
      };
      return {
        ...entity,
        ...metadata,
        details: productDetails(item, entity, metadata),
      };
    });
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
          dataRef: `/capabilities/${index}`,
          detailDataRef: null,
          sourceEntityIds: [capability.id].filter(Boolean).map(String),
          details: productDetails({}, capability, {
            id: capability.id || `FUNCTION-${index + 1}`,
            label,
            inclusion: capability.inclusion,
            truthStatus: capability.truthStatus,
            sourceIds: rows(capability.sourceIds),
            derivationRuleId: capability.derivationRuleId || null,
            detailDataRef: null,
            sourceEntityIds: [capability.id].filter(Boolean).map(String),
          }),
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
  const limits = {
    maxVisibleNodes: positiveInteger(options.maxVisibleNodes, PRODUCT_MAP_PAGE_LIMITS.maxVisibleNodes),
    maxTerminalRows: positiveInteger(options.maxTerminalRows, PRODUCT_MAP_PAGE_LIMITS.maxTerminalRows),
    maxBranches: positiveInteger(options.maxBranches, PRODUCT_MAP_PAGE_LIMITS.maxBranches),
  };
  const model = buildProductMapModel(semanticModel);
  if (!model.branches.length) {
    return [{ segmentIndex: 1, segmentCount: 1, root: model.root, branches: model.branches }];
  }

  const chunks = model.branches.flatMap((branch) => splitBranch(branch, limits));
  const grouped = balancedSequentialGroups(
    chunks,
    (candidate) => segmentFits(candidate, limits),
    branchTerminalRows,
  );
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

// Canonical presentation inventory shared by the product mind map, the
// functional schedule and the delivery roadmap. A structured/decomposed
// subfunction is a terminal row; a function without subfunctions is terminal
// itself. CommercialLock rows intentionally remain at their original pricing
// granularity and are not expanded here.
export function buildProductDeliveryInventory(semanticModel = {}) {
  const model = buildProductMapModel(semanticModel);
  return model.branches.flatMap((branch) => rows(branch.functions).flatMap((item) => {
    const details = rows(item.details);
    const terminals = details.length ? details : [null];
    return terminals.map((detail) => {
      const functionId = String(item.id || branch.id || "FUNCTION");
      const subfunctionId = detail?.id ? String(detail.id) : null;
      const phase = cleanOptionalText(
        detail?.phase || detail?.deadline || item.phase || item.deadline,
        70,
      );
      return {
        // Match the terminal node identity emitted by buildProductMapSpec so
        // downstream pages can prove exact cross-page coverage by ID.
        id: subfunctionId ? `SUB-${safeId(subfunctionId)}` : `CAP-${safeId(functionId)}`,
        epic: cleanText(branch.label, 80),
        functionId,
        functionLabel: cleanText(item.label || entityLabel(item), 80),
        subfunctionId,
        subfunctionLabel: cleanText(detail?.label || item.label || entityLabel(item), 80),
        deadline: phase,
        phase,
        truthStatus: detail?.truthStatus || item.truthStatus,
        inclusion: detail?.inclusion || item.inclusion,
        sourceIds: unique([
          ...rows(item.sourceIds),
          ...rows(detail?.sourceIds),
        ].map(String).filter(Boolean)),
        derivationRuleId: detail?.derivationRuleId || item.derivationRuleId || null,
        dataRef: detail?.dataRef || item.dataRef || null,
        sourceEntityIds: unique([
          ...rows(item.sourceEntityIds),
          ...rows(detail?.sourceEntityIds),
        ].map(String).filter(Boolean)),
      };
    });
  }));
}

function splitBranch(branch, limits) {
  const functionChunks = branch.functions.flatMap((item) => splitFunction(item, branch, limits));
  const chunks = balancedSequentialGroups(
    functionChunks,
    (candidate) => segmentFits([{ ...branch, functions: candidate }], limits),
    functionTerminalRows,
  );
  return chunks.map((functions, index) => ({
    ...branch,
    functions,
    continuationIndex: index + 1,
    continuationCount: chunks.length,
  }));
}

function splitFunction(item, branch, limits) {
  const details = rows(item.details);
  if (!details.length || segmentFits([{ ...branch, functions: [item] }], limits)) return [item];
  const maxDetails = Math.max(1, Math.min(
    limits.maxTerminalRows,
    limits.maxVisibleNodes - 3,
  ));
  const chunkCount = Math.max(1, Math.ceil(details.length / maxDetails));
  const chunks = balancedSlices(details, chunkCount);
  return chunks.map((detailRows, index) => ({
    ...item,
    details: detailRows,
    continuationIndex: index + 1,
    continuationCount: chunks.length,
  }));
}

function segmentFits(branches, { maxVisibleNodes, maxTerminalRows, maxBranches }) {
  const branchKeys = branches.map((branch, index) => normalizeLabel(branch?.id || branch?.label) || String(index));
  const terminalRows = branches.reduce((sum, branch) => sum + branchTerminalRows(branch), 0);
  const nodes = 1 + branches.length + branches.reduce((sum, branch) => sum + branch.functions.reduce((branchSum, item) => branchSum + 1 + rows(item.details).length, 0), 0);
  return branches.length <= maxBranches
    && new Set(branchKeys).size === branchKeys.length
    && terminalRows <= maxTerminalRows
    && nodes <= maxVisibleNodes;
}

export function decomposeProductMapDetail(value) {
  const detail = cleanOptionalText(value, 320);
  if (!detail) return [];
  const normalized = detail
    .replace(/(?:\r?\n|[;•▪◦])+/gu, ",")
    .replace(/\s*,\s*/gu, ",")
    .replace(/,+/gu, ",")
    .replace(/^,|,$/gu, "")
    .trim();
  const parts = normalized
    .split(",")
    .flatMap((part) => part.split(/\s+(?:and|и|va|hamda|ҳамда|ва)\s+/giu))
    .map((part) => cleanOptionalText(part.replace(/^\s*(?:[-–—]|\d+[.)])\s*/u, ""), 80))
    .filter(Boolean);
  return uniqueByLabel(parts.length > 1 ? parts : [detail]);
}

function productDetails(scopeItem, entity, metadata) {
  const output = [];
  const add = (source, fallbackIndex, dataRef = metadata.detailDataRef) => {
    const record = source && typeof source === "object" && !Array.isArray(source) ? source : { label: source };
    const label = cleanOptionalText(record.label || record.name || record.feature || record.title || record.detail || record.description, 80);
    if (!label) return;
    const parentLabels = [metadata.label, entityLabel(entity), scopeItem?.label, scopeItem?.feature].map(normalizeLabel).filter(Boolean);
    if (parentLabels.includes(normalizeLabel(label))) return;
    const sourceIds = unique([
      ...rows(record.sourceIds),
      ...rows(metadata.sourceIds),
    ].map(String).filter(Boolean));
    output.push({
      id: record.id || `${metadata.id || "FUNCTION"}-DETAIL-${fallbackIndex + 1}`,
      label,
      deadline: cleanOptionalText(record.phase || record.deadline || record.deliveryWindow || metadata.phase || metadata.deadline, 70),
      phase: cleanOptionalText(record.phase || record.deadline || record.deliveryWindow || metadata.phase || metadata.deadline, 70),
      truthStatus: record.truthStatus || metadata.truthStatus,
      inclusion: record.inclusion || metadata.inclusion,
      sourceIds,
      derivationRuleId: record.derivationRuleId || metadata.derivationRuleId || null,
      dataRef: record.dataRef || dataRef || null,
      sourceEntityIds: unique([...rows(record.sourceEntityIds), ...rows(metadata.sourceEntityIds)].map(String).filter(Boolean)),
    });
  };

  const structured = uniqueDetailSources(scopeItem, entity);
  for (const [index, source] of structured.entries()) add(source, index, source?.dataRef || metadata.detailDataRef);

  const rawDetail = cleanOptionalText(scopeItem?.detail || scopeItem?.description || entity?.detail || entity?.description, 320);
  if (rawDetail) {
    const decomposed = decomposeProductMapDetail(rawDetail);
    for (const [index, label] of decomposed.entries()) add({ label }, structured.length + index, metadata.detailDataRef);
  }

  const seen = new Map();
  for (const detail of output) {
    const key = normalizeLabel(detail.label);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, detail);
      continue;
    }
    existing.sourceIds = unique([...rows(existing.sourceIds), ...rows(detail.sourceIds)].map(String).filter(Boolean));
    existing.sourceEntityIds = unique([...rows(existing.sourceEntityIds), ...rows(detail.sourceEntityIds)].map(String).filter(Boolean));
    existing.truthStatus = conservativeTruth(existing.truthStatus, detail.truthStatus);
  }
  return [...seen.values()];
}

function uniqueDetailSources(...entities) {
  const values = [];
  const objectSeen = new Set();
  for (const entity of entities) {
    if (!entity || typeof entity !== "object" || objectSeen.has(entity)) continue;
    objectSeen.add(entity);
    for (const key of ["details", "subfunctions", "subFunctions"]) values.push(...rows(entity[key]));
  }
  return values;
}

function uniqueFunctions(items) {
  const grouped = new Map();
  const output = [];
  for (const item of items) {
    const key = normalizeLabel(item?.label) || String(item?.id || output.length + 1);
    const details = rows(item.details);
    const existing = grouped.get(key);
    if (!existing) {
      const created = { ...item, details: [...details] };
      grouped.set(key, created);
      output.push(created);
      continue;
    }
    existing.sourceIds = unique([...rows(existing.sourceIds), ...rows(item.sourceIds)].map(String).filter(Boolean));
    existing.sourceEntityIds = unique([...rows(existing.sourceEntityIds), ...rows(item.sourceEntityIds)].map(String).filter(Boolean));
    existing.truthStatus = conservativeTruth(existing.truthStatus, item.truthStatus);
    for (const detail of details) {
      const matching = existing.details.find((row) => normalizeLabel(row.label) === normalizeLabel(detail.label));
      if (!matching) {
        existing.details.push(detail);
        continue;
      }
      matching.sourceIds = unique([...rows(matching.sourceIds), ...rows(detail.sourceIds)].map(String).filter(Boolean));
      matching.sourceEntityIds = unique([...rows(matching.sourceEntityIds), ...rows(detail.sourceEntityIds)].map(String).filter(Boolean));
      matching.truthStatus = conservativeTruth(matching.truthStatus, detail.truthStatus);
    }
  }
  return output;
}

function balancedSlices(items, count) {
  const output = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const remaining = items.length - offset;
    const remainingGroups = count - index;
    const size = Math.ceil(remaining / remainingGroups);
    output.push(items.slice(offset, offset + size));
    offset += size;
  }
  return output.filter((group) => group.length);
}

function balancedSequentialGroups(items, fits, weightOf) {
  if (!items.length) return [];
  const greedy = [];
  let current = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (current.length && !fits(candidate)) {
      greedy.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length) greedy.push(current);
  if (greedy.length < 2) return greedy;

  const groupCount = greedy.length;
  const prefixWeights = [0];
  for (const item of items) prefixWeights.push(prefixWeights[prefixWeights.length - 1] + Math.max(1, Number(weightOf(item)) || 1));
  const target = prefixWeights[prefixWeights.length - 1] / groupCount;
  const scores = Array.from({ length: groupCount + 1 }, () => Array(items.length + 1).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: groupCount + 1 }, () => Array(items.length + 1).fill(-1));
  scores[0][0] = 0;
  for (let groupIndex = 1; groupIndex <= groupCount; groupIndex += 1) {
    for (let end = groupIndex; end <= items.length; end += 1) {
      for (let start = groupIndex - 1; start < end; start += 1) {
        if (!Number.isFinite(scores[groupIndex - 1][start])) continue;
        const candidate = items.slice(start, end);
        if (!fits(candidate)) continue;
        const weight = prefixWeights[end] - prefixWeights[start];
        const score = scores[groupIndex - 1][start] + ((weight - target) ** 2);
        if (score < scores[groupIndex][end]) {
          scores[groupIndex][end] = score;
          previous[groupIndex][end] = start;
        }
      }
    }
  }
  if (!Number.isFinite(scores[groupCount][items.length])) return greedy;
  const output = [];
  let end = items.length;
  for (let groupIndex = groupCount; groupIndex > 0; groupIndex -= 1) {
    const start = previous[groupIndex][end];
    if (start < 0) return greedy;
    output.unshift(items.slice(start, end));
    end = start;
  }
  return output;
}

function functionTerminalRows(item) {
  return Math.max(1, rows(item?.details).length);
}

function branchTerminalRows(branch) {
  return rows(branch?.functions).reduce((sum, item) => sum + functionTerminalRows(item), 0);
}

function uniqueByLabel(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeLabel(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
