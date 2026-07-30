import { canonicalJson, sha256Digest, validateKpContract } from "./kp_reference_contracts.mjs";
import { TEAM_CAPACITY_EPSILON, canonicalizeTeamPlan } from "./kp_team_capacity.mjs";

export const PAYMENT_PERCENT_POLICY_V1 = Object.freeze({
  version: "1.0",
  totalBasisPoints: 10000,
  tieBreak: "fraction_desc_order_desc_id_asc",
});

export async function createCommercialLock(proposalModel = {}, { requestId, currency = null, currencyExponent = 2 } = {}) {
  const resolvedCurrency = String(currency || proposalModel.pricing?.currency || "XXX").toUpperCase();
  const projectPriceMinor = toMinor(proposalModel.pricing?.projectPrice ?? proposalModel.pricing?.total ?? 0, currencyExponent);
  const functionPrice = (proposalModel.functionPrice || []).map((row, index) => {
    const amountMinor = toMinor(row.total ?? row.amount ?? 0, currencyExponent);
    const truthStatus = row.truthStatus || (amountMinor > 0 ? "assumed" : "unknown");
    return {
      id: row.id || `FP-${String(index + 1).padStart(3, "0")}`,
      name: String(row.name || row.title || row.feature || `Function ${index + 1}`),
      amountMinor,
      truthStatus,
      sourceIds: row.sourceIds || [],
      derivationRuleId: row.derivationRuleId || (amountMinor > 0 && ["assumed", "inferred", "recommended"].includes(truthStatus) ? "V5-FUNCTION-ALLOCATION-SCENARIO" : null),
    };
  });
  const rawPayments = (proposalModel.payments || []).map((row, index) => ({
    id: row.id || `PAY-${String(index + 1).padStart(3, "0")}`,
    name: String(row.name || row.label || `Payment ${index + 1}`),
    amountMinor: toMinor(row.amount ?? 0, currencyExponent),
    order: Number(row.order ?? index + 1),
    acceptance: String(row.acceptance || row.due || "Acceptance trigger to confirm"),
    explicitPercentBasisPoints: hasExplicitPaymentPercent(row) ? toBasisPoints(row.percent ?? row.percentage) : null,
    truthStatus: row.truthStatus || "assumed",
    sourceIds: row.sourceIds || [],
    derivationRuleId: row.derivationRuleId || "V5-PAYMENT-PLANNING-SCENARIO",
  }));
  // A payment schedule needs a positive reconciliation basis. That is the
  // locked project price when one exists; otherwise the client's explicitly
  // stated budget may serve as a planning-scenario basis (never as a quote).
  const budgetAmountMinor = safeBudgetMinor(proposalModel.pricing?.budgetAmount, currencyExponent);
  const budgetCurrencyExplicit = String(proposalModel.pricing?.budgetCurrencyStatus || "").toLowerCase() === "explicit";
  const paymentBasisMinor = projectPriceMinor > 0
    ? projectPriceMinor
    : rawPayments.length && budgetCurrencyExplicit && budgetAmountMinor > 0
      ? budgetAmountMinor
      : 0;
  const allocatedPercentBasisPoints = allocatePaymentPercentBasisPoints(rawPayments, paymentBasisMinor);
  const payments = rawPayments.map((row, index) => {
    const percentBasisPoints = allocatedPercentBasisPoints[index];
    if (row.explicitPercentBasisPoints !== null && row.explicitPercentBasisPoints !== percentBasisPoints) {
      throw Object.assign(new Error(`Explicit payment percentage does not match amount for ${row.id}`), {
        code: "COMMERCIAL_PERCENT_SUM_MISMATCH",
        paymentId: row.id,
        expectedBasisPoints: percentBasisPoints,
        actualBasisPoints: row.explicitPercentBasisPoints,
      });
    }
    return {
      id: row.id,
      name: row.name,
      amountMinor: row.amountMinor,
      percentBasisPoints,
      order: row.order,
      acceptance: row.acceptance,
      truthStatus: row.truthStatus,
      sourceIds: row.sourceIds,
      derivationRuleId: row.derivationRuleId,
    };
  });
  const developmentSubtotalMinor = functionPrice.reduce((sum, row) => sum + row.amountMinor, 0) || projectPriceMinor;
  // A weighted budget-allocation scenario reconciles the function subtotal to
  // the client's explicitly stated budget while the project price stays 0
  // (the budget is never presented as a quote). The basis is recorded so the
  // commercial equation and every downstream QA can verify it fail-closed.
  const allocationBasisMinor = projectPriceMinor === 0
    && developmentSubtotalMinor > 0
    && budgetCurrencyExplicit
    && budgetAmountMinor > 0
    && developmentSubtotalMinor === budgetAmountMinor
    ? budgetAmountMinor
    : 0;
  const durationMonths = Number(proposalModel.durationMonths || proposalModel.duration?.months || 0);
  const durationWeeks = Number(proposalModel.durationWeeks || proposalModel.duration?.weeks || 0);
  const lockWithoutHash = {
    schemaVersion: "1.0",
    requestId,
    currency: resolvedCurrency,
    currencyExponent,
    projectPriceMinor,
    pricing: {
      developmentSubtotalMinor,
      externalCostsIncluded: false,
      externalRows: [],
      paymentBasisMinor,
      allocationBasisMinor,
    },
    functionPriceSubtotalMinor: developmentSubtotalMinor,
    functionPrice,
    payments,
    teamPlan: normalizeCommercialTeamPlan(proposalModel.teamPlan || {}, { durationMonths }),
    durationMonths,
    durationWeeks,
    explicitScopeRows: (proposalModel.scope || []).filter((row) => isCommittedScopeRow(row, proposalModel.sources)).map((row, index) => ({
      id: row.id || `SCOPE-${String(index + 1).padStart(3, "0")}`,
      label: String(row.label || row.feature || row.epic || `Scope ${index + 1}`),
      ownership: String(row.ownership || "owned"),
      inclusion: String(row.inclusion || (row.ownership === "deferred" ? "deferred" : "in_scope")),
      truthStatus: String(row.truthStatus || "explicit"),
      sourceIds: row.sourceIds || [],
    })),
    sourceProposalModelHash: sha256Digest(canonicalJson(proposalModel)),
  };
  const lock = { ...lockWithoutHash, lockHash: sha256Digest(canonicalJson(lockWithoutHash)) };
  assertCommercialEquation(lock);
  await validateKpContract("commercialLock", lock);
  return Object.freeze(lock);
}

function isCommittedScopeRow(row = {}, sources = []) {
  const inclusion = String(row.inclusion || "").toLowerCase();
  const priority = String(row.priority || row.status || "").toLowerCase();
  if (inclusion === "requested" || /requested|confirmed|committed/.test(priority)) return true;
  if (String(row.truthStatus || "").toLowerCase() !== "explicit") return false;
  const clientBriefIds = new Set((sources || [])
    .filter((source) => String(source?.type || "").toLowerCase() === "client_brief")
    .map((source) => String(source?.id || ""))
    .filter(Boolean));
  return (row.sourceIds || []).some((sourceId) => {
    const id = String(sourceId || "");
    return id === "SRC-PROMPT" || clientBriefIds.has(id);
  });
}

export function assertCommercialLock(lock, proposalModel = null) {
  const { lockHash, ...payload } = lock;
  if (sha256Digest(canonicalJson(payload)) !== lockHash) throw Object.assign(new Error("Commercial lock hash mismatch"), { code: "COMMERCIAL_LOCK_HASH_MISMATCH" });
  assertCommercialEquation(lock);
  if (proposalModel) {
    const expected = Number(proposalModel.pricing?.projectPrice ?? proposalModel.pricing?.total ?? 0);
    if (toMinor(expected, lock.currencyExponent) !== lock.projectPriceMinor) throw Object.assign(new Error("Commercial lock does not match proposal price"), { code: "COMMERCIAL_LOCK_PRICE_MISMATCH" });
  }
  return true;
}

export function toMinor(value, exponent = 2) {
  const text = String(value ?? 0).replace(/[$,\s]/g, "");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw Object.assign(new Error(`Invalid money value: ${value}`), { code: "COMMERCIAL_MONEY_INVALID" });
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > exponent) throw Object.assign(new Error("Money value has excess precision"), { code: "COMMERCIAL_MONEY_PRECISION" });
  const minor = BigInt(whole) * (10n ** BigInt(exponent)) + BigInt((fraction + "0".repeat(exponent)).slice(0, exponent) || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw Object.assign(new Error("Money value exceeds safe integer range"), { code: "COMMERCIAL_MONEY_OVERFLOW" });
  return Number(minor);
}

export function allocatePaymentPercentBasisPoints(payments = [], projectPriceMinor) {
  if (!payments.length) return [];
  if (!Number.isSafeInteger(projectPriceMinor) || projectPriceMinor <= 0) {
    throw Object.assign(new Error("Project price must be a positive safe integer before allocating payment percentages"), { code: "COMMERCIAL_PRICE_SUM_MISMATCH" });
  }
  const amountSum = payments.reduce((sum, row) => {
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor < 0) {
      throw Object.assign(new Error(`Payment amount is not a non-negative safe integer: ${row.id}`), { code: "COMMERCIAL_PAYMENT_SUM_MISMATCH" });
    }
    return sum + BigInt(row.amountMinor);
  }, 0n);
  if (amountSum !== BigInt(projectPriceMinor)) {
    throw Object.assign(new Error("Payment amounts must sum to the project price before percentage allocation"), { code: "COMMERCIAL_PAYMENT_SUM_MISMATCH" });
  }

  const denominator = BigInt(projectPriceMinor);
  const totalBasisPoints = BigInt(PAYMENT_PERCENT_POLICY_V1.totalBasisPoints);
  const allocations = payments.map((row, index) => {
    const numerator = BigInt(row.amountMinor) * totalBasisPoints;
    return {
      index,
      id: String(row.id || ""),
      order: Number(row.order ?? index + 1),
      quotient: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  let remaining = PAYMENT_PERCENT_POLICY_V1.totalBasisPoints - allocations.reduce((sum, row) => sum + row.quotient, 0);
  const ranked = [...allocations].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    if (left.order !== right.order) return right.order - left.order;
    return left.id.localeCompare(right.id);
  });
  for (let index = 0; index < remaining; index += 1) ranked[index].quotient += 1;
  const result = allocations.sort((left, right) => left.index - right.index).map((row) => row.quotient);
  if (result.reduce((sum, value) => sum + value, 0) !== PAYMENT_PERCENT_POLICY_V1.totalBasisPoints) {
    throw Object.assign(new Error("Allocated payment percentages do not sum to 100%"), { code: "COMMERCIAL_PERCENT_SUM_MISMATCH" });
  }
  return result;
}

function toBasisPoints(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) throw Object.assign(new Error("Invalid percent value"), { code: "COMMERCIAL_PERCENT_INVALID" });
  return Math.round(number * 100);
}

function hasExplicitPaymentPercent(row = {}) {
  return row.percentExplicit === true || row.percentageSource === "explicit" || row.percentTruthStatus === "explicit";
}

export function normalizeCommercialTeamPlan(teamPlan, { durationMonths = null } = {}) {
  try {
    return canonicalizeTeamPlan(teamPlan, { durationMonths });
  } catch (error) {
    throw Object.assign(new Error(error.message), { code: "COMMERCIAL_TEAM_TOTAL_MISMATCH", cause: error });
  }
}

export function commercialPaymentBasisMinor(lock = {}) {
  const basis = Number(lock.pricing?.paymentBasisMinor);
  return Number.isSafeInteger(basis) && basis > 0 ? basis : Number(lock.projectPriceMinor) || 0;
}

function safeBudgetMinor(value, exponent) {
  try {
    return toMinor(value ?? 0, exponent);
  } catch {
    return 0;
  }
}

function assertCommercialEquation(lock) {
  const includedExternalMinor = (lock.pricing.externalRows || []).filter((row) => row.includedInProjectPrice).reduce((sum, row) => sum + row.amountMinor, 0);
  const functionSum = lock.functionPrice.reduce((sum, row) => sum + row.amountMinor, 0);
  const paymentSum = lock.payments.reduce((sum, row) => sum + row.amountMinor, 0);
  const paymentBasisMinor = commercialPaymentBasisMinor(lock);
  const percentSum = lock.payments.reduce((sum, row) => sum + row.percentBasisPoints, 0);
  const team = lock.teamPlan || {};
  const roleAllocations = team.roleAllocations || [];
  const monthCount = Number(team.monthCount);
  const monthlyTotals = team.monthlyTotals || [];
  const allocationBasisMinor = Number(lock.pricing?.allocationBasisMinor) > 0 ? Number(lock.pricing.allocationBasisMinor) : 0;
  if (lock.projectPriceMinor > 0 || !allocationBasisMinor) {
    if (lock.projectPriceMinor !== lock.pricing.developmentSubtotalMinor + includedExternalMinor) throw Object.assign(new Error("Project price equation mismatch"), { code: "COMMERCIAL_PROJECT_TOTAL_MISMATCH" });
  } else if (lock.pricing.developmentSubtotalMinor + includedExternalMinor !== allocationBasisMinor) {
    throw Object.assign(new Error("Budget allocation basis mismatch"), { code: "COMMERCIAL_PROJECT_TOTAL_MISMATCH" });
  }
  if (Boolean(lock.pricing.externalCostsIncluded) !== (includedExternalMinor > 0)) throw Object.assign(new Error("External-cost inclusion flag mismatch"), { code: "COMMERCIAL_PROJECT_TOTAL_MISMATCH" });
  if (functionSum !== lock.functionPriceSubtotalMinor) throw Object.assign(new Error("Function price subtotal mismatch"), { code: "COMMERCIAL_FUNCTION_TOTAL_MISMATCH" });
  if (lock.functionPriceSubtotalMinor !== lock.pricing.developmentSubtotalMinor) throw Object.assign(new Error("Function subtotal differs from development subtotal"), { code: "COMMERCIAL_FUNCTION_TOTAL_MISMATCH" });
  if (lock.payments.length && paymentSum !== paymentBasisMinor) throw Object.assign(new Error("Payment total mismatch"), { code: "COMMERCIAL_PAYMENT_TOTAL_MISMATCH" });
  if (lock.payments.length && percentSum !== PAYMENT_PERCENT_POLICY_V1.totalBasisPoints) throw Object.assign(new Error("Payment percentages must sum to 100%"), { code: "COMMERCIAL_PERCENT_SUM_MISMATCH" });
  if (Number(team.roleCount || 0) !== (team.roles || []).length || new Set(team.roles || []).size !== (team.roles || []).length) {
    throw Object.assign(new Error("Team role count is inconsistent"), { code: "COMMERCIAL_TEAM_TOTAL_MISMATCH" });
  }
  if (!Number.isInteger(monthCount) || monthCount !== Number(lock.durationMonths) || monthlyTotals.length !== monthCount) {
    throw Object.assign(new Error("Team month inventory is inconsistent"), { code: "COMMERCIAL_TEAM_TOTAL_MISMATCH" });
  }
  if (roleAllocations.length) {
    const allocationRoles = roleAllocations.map((row) => row.role);
    const roleSet = new Set(team.roles || []);
    if (roleAllocations.length !== roleSet.size || new Set(allocationRoles).size !== allocationRoles.length || allocationRoles.some((role) => !roleSet.has(role))) {
      throw Object.assign(new Error("Team role allocation inventory is inconsistent"), { code: "COMMERCIAL_TEAM_TOTAL_MISMATCH" });
    }
    const rolesReconcile = roleAllocations.every((row) => {
      const months = row.monthlyFte || [];
      const rolePeak = months.length ? Math.max(...months.map(Number)) : 0;
      const roleFteMonths = months.reduce((sum, value) => sum + Number(value), 0);
      return months.length === monthCount
        && Math.abs(rolePeak - Number(row.peakFte)) <= TEAM_CAPACITY_EPSILON
        && Math.abs(roleFteMonths - Number(row.fteMonths)) <= TEAM_CAPACITY_EPSILON;
    });
    const computedMonthlyTotals = Array.from({ length: monthCount }, (_, monthIndex) => roleAllocations.reduce(
      (sum, row) => sum + Number(row.monthlyFte?.[monthIndex] || 0),
      0,
    ));
    const monthlyTotalsReconcile = monthlyTotals.length === monthCount
      && monthlyTotals.every((value, monthIndex) => Math.abs(Number(value) - computedMonthlyTotals[monthIndex]) <= TEAM_CAPACITY_EPSILON);
    const allocatedFteMonths = roleAllocations.reduce((sum, row) => sum + Number(row.fteMonths), 0);
    const aggregatePeakFte = computedMonthlyTotals.length ? Math.max(...computedMonthlyTotals) : 0;
    const aggregatePeakMonth = aggregatePeakFte > 0 ? computedMonthlyTotals.indexOf(aggregatePeakFte) + 1 : null;
    if (!Number.isInteger(monthCount) || monthCount !== Number(lock.durationMonths) || !rolesReconcile || !monthlyTotalsReconcile
      || Math.abs(aggregatePeakFte - Number(team.peakFte)) > TEAM_CAPACITY_EPSILON
      || Math.abs(allocatedFteMonths - Number(team.fteMonths)) > TEAM_CAPACITY_EPSILON
      || (team.peakMonth ?? null) !== aggregatePeakMonth
      || Number(team.people) + TEAM_CAPACITY_EPSILON < aggregatePeakFte) {
      throw Object.assign(new Error("Team capacity allocation does not reconcile to the aggregate"), { code: "COMMERCIAL_TEAM_TOTAL_MISMATCH" });
    }
  } else if (monthlyTotals.some((value) => Math.abs(Number(value)) > TEAM_CAPACITY_EPSILON)
    || Math.abs(Number(team.peakFte)) > TEAM_CAPACITY_EPSILON
    || Math.abs(Number(team.fteMonths)) > TEAM_CAPACITY_EPSILON
    || (team.peakMonth ?? null) !== null) {
    throw Object.assign(new Error("Empty team capacity must reconcile to zero"), { code: "COMMERCIAL_TEAM_TOTAL_MISMATCH" });
  }
}
