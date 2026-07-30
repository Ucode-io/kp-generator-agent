const FRONT_LOADED_ROLE = /design|designer|ui\/ux|ux|дизайн|дизайнер|dizayn|dizayner/iu;
const BACK_LOADED_ROLE = /(?:^|\W)(qa|quality|test|testing|sifat|тест|тестирование)(?:\W|$)/iu;

export const TEAM_CAPACITY_EPSILON = 0.0005;

/**
 * Produces the single canonical team-capacity representation used by the
 * proposal, commercial lock, semantic model, renderer and QA layers.
 *
 * A supplied peak/quantity is an allocation ceiling until the monthly plan is
 * known. The canonical role peak is always max(monthlyFte), while aggregate
 * peak is always max(monthlyTotals).
 */
export function canonicalizeTeamPlan(teamPlan = {}, { durationMonths = null } = {}) {
  const source = Array.isArray(teamPlan) ? {} : (teamPlan || {});
  const inputRows = teamRows(teamPlan);
  const monthCount = resolveMonthCount(source, inputRows, durationMonths);
  const explicitRoleNames = Array.isArray(source.roles)
    ? source.roles.map(roleName).filter(Boolean)
    : [];
  const roles = unique([...explicitRoleNames, ...inputRows.map(roleName).filter(Boolean)]);
  const allocationsByRole = new Map();

  for (const [index, input] of inputRows.entries()) {
    const row = typeof input === "string" ? { role: input } : (input || {});
    const role = roleName(row) || `Role ${index + 1}`;
    const monthlyFte = canonicalMonthlyFte(row, role, monthCount, index);
    if (!monthlyFte) continue;
    const current = allocationsByRole.get(role) || {
      role,
      monthlyFte: Array(monthCount).fill(0),
      people: null,
      truthStatus: row.truthStatus || null,
      sourceIds: [],
      derivationRuleId: row.derivationRuleId || null,
    };
    current.monthlyFte = current.monthlyFte.map((value, monthIndex) => roundCapacity(value + monthlyFte[monthIndex]));
    current.people = firstNonNegative(current.people, row.people, row.count);
    current.truthStatus ||= row.truthStatus || null;
    current.sourceIds = unique([...current.sourceIds, ...array(row.sourceIds).map(String).filter(Boolean)]);
    current.derivationRuleId ||= row.derivationRuleId || null;
    allocationsByRole.set(role, current);
  }

  const roleAllocations = [...allocationsByRole.values()].map((row) => {
    const fteMonths = sumCapacity(row.monthlyFte);
    const peakFte = row.monthlyFte.length ? Math.max(...row.monthlyFte) : 0;
    return compact({
      role: row.role,
      people: row.people,
      monthlyFte: row.monthlyFte,
      peakFte: roundCapacity(peakFte),
      fteMonths,
      truthStatus: row.truthStatus,
      sourceIds: row.sourceIds.length ? row.sourceIds : null,
      derivationRuleId: row.derivationRuleId,
    });
  });
  const monthlyTotals = Array.from({ length: monthCount }, (_, monthIndex) => roundCapacity(
    roleAllocations.reduce((sum, row) => sum + Number(row.monthlyFte[monthIndex] || 0), 0),
  ));
  const peakFte = monthlyTotals.length ? roundCapacity(Math.max(...monthlyTotals)) : 0;
  const peakMonth = monthlyTotals.length && peakFte > 0 ? monthlyTotals.indexOf(peakFte) + 1 : null;
  const fteMonths = sumCapacity(roleAllocations.map((row) => row.fteMonths));
  const derivedPeople = roleAllocations.reduce((sum, row) => sum + Math.ceil(Number(row.peakFte || 0)), 0);
  const suppliedPeople = firstNonNegative(source.people, source.count);

  return {
    roles,
    roleAllocations,
    roleCount: roles.length,
    people: suppliedPeople ?? derivedPeople,
    monthCount,
    monthlyTotals,
    peakMonth,
    fteMonths,
    peakFte,
    truthStatus: source.truthStatus || "assumed",
    sourceIds: array(source.sourceIds).map(String).filter(Boolean),
    derivationRuleId: source.derivationRuleId || "V5-TEAM-PLANNING-SCENARIO",
  };
}

export function teamCapacitySignature(teamPlan = {}, { durationMonths = null } = {}) {
  const canonical = canonicalizeTeamPlan(teamPlan, { durationMonths });
  return {
    people: canonical.people,
    roleCount: canonical.roleCount,
    roles: canonical.roleAllocations.map((row) => ({
      role: row.role,
      monthlyFte: row.monthlyFte,
      peakFte: row.peakFte,
      fteMonths: row.fteMonths,
    })),
    monthCount: canonical.monthCount,
    monthlyTotals: canonical.monthlyTotals,
    peakMonth: canonical.peakMonth,
    peakFte: canonical.peakFte,
    fteMonths: canonical.fteMonths,
  };
}

export function teamCapacitySignaturesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalMonthlyFte(row, role, monthCount, index) {
  if (Array.isArray(row.monthlyFte)) {
    if (row.monthlyFte.length !== monthCount) {
      throw teamCapacityError(`team row ${index + 1} monthlyFte must contain ${monthCount} values`);
    }
    return row.monthlyFte.map((value, monthIndex) => capacityNumber(
      value,
      `team row ${index + 1} monthlyFte[${monthIndex}]`,
    ));
  }
  const capacityCeiling = firstNonNegative(row.peakFte, row.fte, row.qty, row.people, row.count);
  const explicitFteMonths = firstNonNegative(row.fteMonths);
  const activeMonths = firstNonNegative(row.months, row.durationMonths);
  if (capacityCeiling === null || (explicitFteMonths === null && activeMonths === null)) return null;
  const fteMonths = roundCapacity(explicitFteMonths ?? capacityCeiling * activeMonths);
  if (!monthCount) {
    if (fteMonths === 0) return [];
    throw teamCapacityError(`team row ${index + 1} requires a positive durationMonths value`);
  }
  if (fteMonths > capacityCeiling * monthCount + TEAM_CAPACITY_EPSILON) {
    throw teamCapacityError(`team row ${index + 1} FTE-months exceed its allocation ceiling`);
  }
  return allocateMonthlyFte(role, capacityCeiling, fteMonths, monthCount);
}

function allocateMonthlyFte(role, capacityCeiling, fteMonths, monthCount) {
  const values = Array(monthCount).fill(0);
  const normalizedRole = String(role || "").toLowerCase();
  const frontLoaded = FRONT_LOADED_ROLE.test(normalizedRole);
  const backLoaded = BACK_LOADED_ROLE.test(normalizedRole);
  if (!frontLoaded && !backLoaded) {
    const even = roundCapacity(fteMonths / monthCount);
    for (let index = 0; index < monthCount - 1; index += 1) values[index] = even;
    values[monthCount - 1] = roundCapacity(fteMonths - sumCapacity(values.slice(0, -1)));
  } else {
    let remaining = fteMonths;
    const order = frontLoaded
      ? Array.from({ length: monthCount }, (_, index) => index)
      : Array.from({ length: monthCount }, (_, index) => monthCount - index - 1);
    for (const index of order) {
      values[index] = roundCapacity(Math.min(capacityCeiling, remaining));
      remaining = roundCapacity(remaining - values[index]);
    }
    if (Math.abs(remaining) > TEAM_CAPACITY_EPSILON) {
      throw teamCapacityError(`team role ${role} cannot be allocated within its monthly ceiling`);
    }
  }
  if (values.some((value) => value > capacityCeiling + TEAM_CAPACITY_EPSILON)) {
    throw teamCapacityError(`team role ${role} exceeds its monthly allocation ceiling`);
  }
  return values;
}

function resolveMonthCount(source, rows, suppliedDuration) {
  const explicit = firstPositiveInteger(suppliedDuration, source.monthCount, source.durationMonths);
  if (explicit !== null) return explicit;
  const lengths = rows.filter((row) => row && typeof row === "object" && Array.isArray(row.monthlyFte)).map((row) => row.monthlyFte.length);
  if (!lengths.length) return 0;
  if (new Set(lengths).size !== 1) throw teamCapacityError("team monthlyFte rows must use the same month count");
  return lengths[0];
}

function teamRows(teamPlan) {
  if (Array.isArray(teamPlan)) return teamPlan;
  if (Array.isArray(teamPlan?.roleAllocations) && teamPlan.roleAllocations.length) return teamPlan.roleAllocations;
  if (Array.isArray(teamPlan?.team) && teamPlan.team.length) return teamPlan.team;
  if (Array.isArray(teamPlan?.roles) && teamPlan.roles.some((row) => row && typeof row === "object")) return teamPlan.roles;
  return [];
}

function roleName(row) {
  if (typeof row === "string") return String(row).trim();
  return String(row?.role || row?.name || row?.label || "").trim();
}

function capacityNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw teamCapacityError(`${field} must be a non-negative finite number`);
  return roundCapacity(parsed);
}

function firstNonNegative(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return roundCapacity(parsed);
  }
  return null;
}

function firstPositiveInteger(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function sumCapacity(values) {
  return roundCapacity(array(values).reduce((sum, value) => sum + Number(value || 0), 0));
}

function roundCapacity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values)];
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function teamCapacityError(message) {
  return Object.assign(new Error(message), { code: "TEAM_CAPACITY_INVALID" });
}
