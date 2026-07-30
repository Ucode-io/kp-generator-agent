export const PREMIUM_PROPOSAL_PAGE_COUNT = 21;
const TOTAL_PAGES = PREMIUM_PROPOSAL_PAGE_COUNT;

const DEFAULT_COLORS = Object.freeze({
  canvas: "#0A0A10",
  paper: "#17141F",
  ink: "#F2EFE6",
  ink2: "#D8D3DE",
  muted: "#A39CAD",
  quiet: "#756F82",
  rule: "#342D42",
  brand: "#7C5CFF",
  brandDark: "#A78BFA",
  brandSoft: "#241B3D",
  positive: "#4ED9A4",
  warning: "#D9A94E",
  critical: "#F0705A",
});

const PRIVATE_SOURCE_PATTERN = /(?:file|telegram|data):\/\/|(?:^|\s)(?:\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)|\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b|\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/i;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function compact(value = "", max = 260) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function safeHex(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

function hexToRgb(hex) {
  const safe = safeHex(hex, "#000000").slice(1);
  return {
    r: Number.parseInt(safe.slice(0, 2), 16),
    g: Number.parseInt(safe.slice(2, 4), 16),
    b: Number.parseInt(safe.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function mixHex(a, b, weight = 0.5) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  return rgbToHex({
    r: left.r * (1 - weight) + right.r * weight,
    g: left.g * (1 - weight) + right.g * weight,
    b: left.b * (1 - weight) + right.b * weight,
  });
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function accessibleBrandDark(brand, background = DEFAULT_COLORS.canvas) {
  if (contrastRatio(brand, background) >= 4.5) return brand;
  for (const amount of [0.18, 0.3, 0.42, 0.54, 0.66]) {
    const candidate = mixHex(brand, "#FFFFFF", amount);
    if (contrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return DEFAULT_COLORS.brandDark;
}

function themeFromTokens(themeTokens = {}) {
  const brand = safeHex(themeTokens.brand || themeTokens.primary, DEFAULT_COLORS.brand);
  const requestedBrandText = safeHex(themeTokens.brandDeep || themeTokens.brandDark, brand);
  const brandDark = accessibleBrandDark(requestedBrandText);
  const derivedBrandSoft = mixHex(brand, DEFAULT_COLORS.canvas, 0.76);
  const requestedBrandSoft = safeHex(
    themeTokens.darkTint || themeTokens.brandSoftDark || themeTokens.brandTint || themeTokens.brandSoft,
    derivedBrandSoft,
  );
  const brandSoft = relativeLuminance(requestedBrandSoft) <= 0.12
    ? requestedBrandSoft
    : derivedBrandSoft;
  const brandOn = contrastRatio(brand, "#0A0A10") >= contrastRatio(brand, "#FFFFFF")
    ? "#0A0A10"
    : "#FFFFFF";
  const brandDarkOn = contrastRatio(brandDark, "#0A0A10") >= contrastRatio(brandDark, "#FFFFFF")
    ? "#0A0A10"
    : "#FFFFFF";
  return { ...DEFAULT_COLORS, brand, brandDark, brandSoft, brandOn, brandDarkOn };
}

function money(value, currency = "USD") {
  const amount = finiteNumber(value, 0);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString("en-US")}`;
  }
}

function numberText(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(finiteNumber(value, 0));
}

function normalizedTitle(value = "") {
  let title = compact(value, 120)
    .replace(/\b(?:generate|make|create|qil|qiber|qber|ber|kere|kerak)\b.*$/i, "")
    .replace(/\b(?:premium\s+)?(?:commercial\s+)?(?:kp|pdf|proposal)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[,:;\-–—]+$/g, "")
    .trim();
  if (!title || title.length < 3) title = "Commercial proposal";
  return compact(title, 96);
}

function titleSizeClass(title) {
  const length = String(title || "").length;
  if (length > 78) return "title-compact";
  if (length > 48) return "title-long";
  return "title-standard";
}

function projectContext({ question = "", selected = [], allProjects = [], proposalModel = {} } = {}) {
  const selectedProjects = list(selected);
  const portfolioMode = selectedProjects.length > 1;
  const project = selectedProjects[0] || list(allProjects)[0] || {};
  const groundedBrief = proposalModel.groundedBrief || {};
  const brief = proposalModel.brief || {};
  const explicitTitle = groundedBrief.projectName?.value;
  const workingTitle = groundedBrief.workingTitle?.value;
  const rawTitle = portfolioMode
    ? "Project KP Portfolio"
    : brief.projectName || explicitTitle || workingTitle || project.title || question || "Commercial proposal";
  const title = portfolioMode ? "Project KP Portfolio" : normalizedTitle(rawTitle);
  const portfolioProjects = portfolioMode ? selectedProjects : [];
  const currency = groundedBrief.budget?.currency?.value || project.currency || "USD";
  const projectPrice = finiteNumber(
    proposalModel.pricing?.projectPrice ??
      proposalModel.pricing?.developmentTotal ??
      groundedBrief.budget?.usdAmount ??
      groundedBrief.budget?.amount?.value ??
      project.budget_usd,
    0,
  );
  const duration = proposalDuration(proposalModel, project);
  const analog = compact(
    groundedBrief.analog?.name?.value || brief.analog || project.analog || "",
    80,
  );
  return {
    project,
    title,
    focusTitle: compact(project.title || title, 96),
    portfolioMode,
    portfolioProjects,
    currency,
    currencyStatus: compact(groundedBrief.budget?.currency?.status || "unknown", 24),
    projectPrice,
    duration,
    analog: /not specified|unknown/i.test(analog) ? "" : analog,
    type: compact(groundedBrief.productCategory?.value || brief.type || project.type || "Digital product", 80),
    locale: brief.locale || groundedBrief.sourceLanguage || "en",
  };
}

function proposalDuration(model = {}, project = {}) {
  const grounded = finiteNumber(model.groundedBrief?.timeline?.months?.value, 0);
  if (grounded > 0) return Math.round(grounded);
  const briefText = String(model.brief?.duration || "");
  const briefNumber = Number.parseFloat(briefText.match(/\d+(?:\.\d+)?/)?.[0] || "");
  if (Number.isFinite(briefNumber) && briefNumber > 0) return Math.round(briefNumber);
  const projectMonths = finiteNumber(project.duration_months, 0);
  return Math.max(1, Math.round(projectMonths || 3));
}

function narrativeFromModel(model = {}) {
  const narrative = model.narrative || model.groundedNarrative || {};
  return {
    executiveSummary: compact(
      narrative.executiveSummary || model.executiveSummary || "The proposal aligns scope, delivery, evidence, and commercial acceptance in one decision document.",
      650,
    ),
    problemStatement: compact(
      narrative.problemStatement || model.problemStatement || "The confirmed product need must be converted into a controlled workflow with clear ownership and acceptance rules.",
      620,
    ),
    solutionNarrative: compact(
      narrative.solutionNarrative || model.solutionNarrative || "The delivery model prioritizes explicit client scope, makes assumptions visible, and ties each phase to a reviewable outcome.",
      620,
    ),
    differentiators: list(narrative.differentiators || model.differentiators)
      .map((item) => compact(item, 220))
      .filter(Boolean)
      .slice(0, 4),
    status: compact(narrative.status || model.validation?.groundingStatus || "proposal model", 50),
    mode: compact(narrative.mode || "deterministic", 30),
  };
}

function claimLedgerFromModel(model = {}) {
  return list(model.claimLedger || model.narrative?.claimLedger || model.groundedNarrative?.claimLedger)
    .map((claim, index) => ({
      id: compact(claim.id || `CLM-${String(index + 1).padStart(3, "0")}`, 30),
      claim: compact(claim.claim || claim.text || "", 240),
      kind: compact(claim.kind || "evidence", 30),
      status: compact(claim.status || "single_source", 30),
      sourceIds: list(claim.sourceIds).map((item) => compact(item, 40)).slice(0, 4),
    }))
    .filter((claim) => claim.claim)
    .slice(0, 16);
}

function normalizedScope(model = {}, project = {}) {
  const sourceRows = list(model.scope).length ? list(model.scope) : list(project.scope);
  return sourceRows
    .map((row, index) => {
      if (Array.isArray(row)) {
        return {
          epic: compact(row[0] || "Product", 80),
          feature: compact(row[1] || row[2] || `Scope item ${index + 1}`, 110),
          detail: compact(row[2] || "", 170),
          phase: compact(row[3] || "", 45),
          status: compact(row[4] || "In scope", 40),
        };
      }
      return {
        epic: compact(row.epic || row.group || row.module || "Product", 80),
        feature: compact(row.feature || row.task || row.name || row.subtask || `Scope item ${index + 1}`, 110),
        detail: compact(row.detail || row.subtask || row.description || "", 170),
        phase: compact(row.phase || row.deadline || row.period || "", 45),
        status: compact(row.status || "In scope", 40),
      };
    })
    .filter((row) => row.feature)
    .filter((row, index, rows) => rows.findIndex((candidate) => `${candidate.epic}|${candidate.feature}`.toLowerCase() === `${row.epic}|${row.feature}`.toLowerCase()) === index)
    .slice(0, 48);
}

function hasConfirmedFeatureScope(model = {}, scope = []) {
  const briefScope = list(model.groundedBrief?.scope);
  if (briefScope.length) {
    return briefScope.some((item) => item?.status === "explicit" || item?.inclusion === "requested");
  }
  return scope.some((item) => /^(?:in scope|requested|explicit)$/i.test(String(item.status || "")));
}

function scopeGroups(scope = []) {
  const map = new Map();
  for (const row of scope) {
    const key = row.epic || "Product";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  const groups = [...map.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  if (groups.length <= 6) return groups;
  const visible = groups.slice(0, 5);
  const remainder = groups.slice(5).flatMap((group) => group.items);
  visible.push({ name: "Additional scope", items: remainder });
  return visible;
}

function sourceDomain(value = "") {
  const raw = String(value || "").trim();
  if (!raw || PRIVATE_SOURCE_PATTERN.test(raw)) return "Internal evidence reference";
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) return "Evidence reference";
    if (PRIVATE_SOURCE_PATTERN.test(parsed.hostname)) return "Internal evidence reference";
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    if (/[/\\]/.test(raw)) return "Evidence reference";
    return compact(raw, 60);
  }
}

function safeSourceHref(value = "") {
  const raw = String(value || "").trim();
  if (!raw || PRIVATE_SOURCE_PATTERN.test(raw)) return "";
  try {
    const parsed = new URL(raw);
    return /^https?:$/.test(parsed.protocol) && !PRIVATE_SOURCE_PATTERN.test(parsed.hostname) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeSourceLabel(value = "") {
  const text = String(value || "").trim();
  if (!text || PRIVATE_SOURCE_PATTERN.test(text) || /[/\\]{2,}/.test(text)) return "Evidence reference";
  return compact(text, 80);
}

function normalizedSources(model = {}) {
  return list(model.sources)
    .map((source, index) => ({
      id: compact(source.id || `SRC-${String(index + 1).padStart(3, "0")}`, 30),
      type: compact(String(source.type || "evidence").replaceAll("_", " "), 40),
      label: safeSourceLabel(source.label || source.title || source.type || "Evidence reference"),
      domain: sourceDomain(source.source || source.url || source.sourceRef || ""),
      href: safeSourceHref(source.source || source.url || source.sourceRef || ""),
      status: compact(source.status || "provided", 35),
    }))
    .filter((source, index, rows) => rows.findIndex((candidate) => `${candidate.type}|${candidate.label}|${candidate.domain}`.toLowerCase() === `${source.type}|${source.label}|${source.domain}`.toLowerCase()) === index)
    .slice(0, 40);
}

function evidenceState(model = {}, sources = [], claims = []) {
  const researchStatus = String(model.researchStatus?.status || model.validation?.researchStatus || "").toLowerCase();
  const groundingStatus = String(model.validation?.groundingStatus || model.groundedNarrative?.status || "").toLowerCase();
  if (/verified|grounded/.test(groundingStatus) && sources.length >= 3 && claims.length >= 3) {
    return { label: "Evidence-backed", tone: "positive", detail: `${claims.length} claims · ${sources.length} sources` };
  }
  if (/offline|limited|fallback/.test(`${researchStatus} ${groundingStatus}`) || sources.length < 2) {
    return { label: "Assumption-aware", tone: "warning", detail: `${claims.length} claims · ${sources.length} sources` };
  }
  return { label: "Evidence in review", tone: "neutral", detail: `${claims.length} claims · ${sources.length} sources` };
}

function phaseNumber(value = "") {
  const match = String(value).match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function actorForScope(row = {}) {
  const text = `${row.epic} ${row.feature} ${row.detail}`.toLowerCase();
  if (/payment|bank|sms|email|telegram|integration|external|api/.test(text)) return "External service";
  if (/admin|moderation|manager|operator|report|analytics/.test(text)) return "Operations";
  if (/seller|restaurant|courier|doctor|teacher|merchant|partner/.test(text)) return "Business user";
  if (/backend|database|security|auth|system/.test(text)) return "Platform";
  return "End user";
}

function journeySteps(scope = [], context = {}) {
  const ordered = [...scope].sort((a, b) => phaseNumber(a.phase) - phaseNumber(b.phase));
  const distinct = ordered.filter((row, index, rows) => rows.findIndex((candidate) => candidate.feature.toLowerCase() === row.feature.toLowerCase()) === index);
  if (distinct.length >= 4) {
    return distinct.slice(0, 7).map((row, index) => ({
      number: index + 1,
      actor: actorForScope(row),
      title: row.feature,
      detail: row.detail || row.epic,
      status: row.status || "In scope",
    }));
  }
  const category = `${context.type} ${context.title}`.toLowerCase();
  const fallback = /marketplace/.test(category)
    ? [
        ["Buyer", "Discover offer", "Search, catalog, and product detail"],
        ["Platform", "Validate request", "Identity, availability, and business rules"],
        ["Seller", "Confirm fulfilment", "Inventory, terms, and ownership"],
        ["Platform", "Complete transaction", "Order state and payment hand-off"],
        ["Operations", "Moderate and report", "Exceptions, support, and analytics"],
      ]
    : /delivery|food/.test(category)
      ? [
          ["Customer", "Place order", "Menu, basket, address, and payment choice"],
          ["Platform", "Validate order", "Availability, pricing, and confirmation"],
          ["Business user", "Prepare order", "Restaurant acceptance and preparation"],
          ["Business user", "Deliver order", "Courier assignment and live status"],
          ["Operations", "Close and reconcile", "Completion, support, and reporting"],
        ]
      : [
          ["End user", "Submit request", "Primary user input and consent"],
          ["Platform", "Validate", "Required data, access, and business rules"],
          ["Business user", "Process", "Core operational workflow"],
          ["Operations", "Review", "Control, exception handling, and reporting"],
          ["End user", "Receive outcome", "Status, result, and next action"],
        ];
  return fallback.map((row, index) => ({ number: index + 1, actor: row[0], title: row[1], detail: row[2], status: "Recommended journey" }));
}

function architectureLayers(scope = [], model = {}) {
  const textRows = scope.map((row) => `${row.epic} ${row.feature} ${row.detail}`.toLowerCase());
  const channels = [];
  if (textRows.some((text) => /mobile|ios|android/.test(text))) channels.push("Mobile application");
  if (textRows.some((text) => /web|website|portal|cabinet/.test(text))) channels.push("Web experience");
  if (textRows.some((text) => /admin|manager|operator|moderation/.test(text))) channels.push("Admin workspace");
  if (textRows.some((text) => /bot|telegram|chat/.test(text))) channels.push("Messaging channel");
  if (!channels.length) channels.push("Primary client interface");

  const groups = scopeGroups(scope).map((group) => group.name).filter(Boolean).slice(0, 5);
  const services = groups.length ? groups : ["Core product service", "Operations service"];
  const data = ["Operational datastore"];
  if (textRows.some((text) => /report|analytics|dashboard|audit/.test(text))) data.push("Reporting & audit data");
  if (textRows.some((text) => /media|file|image|document/.test(text))) data.push("Object storage");

  const externalRows = list(model.pricing?.infraExternal)
    .map((item) => compact(item.component || item.name || "", 55))
    .filter(Boolean)
    .slice(0, 5);
  const scopeExternal = scope
    .filter((row) => /payment|integration|sms|email|telegram|external|api/i.test(`${row.epic} ${row.feature} ${row.detail}`))
    .map((row) => row.feature)
    .slice(0, 4);
  const external = unique([...scopeExternal, ...externalRows]).slice(0, 5);
  if (!external.length) external.push("External dependency · confirm in discovery");

  return [
    { label: "Channels", state: "Requested / inferred", items: channels },
    { label: "Application", state: "Scope-derived", items: services },
    { label: "Data", state: "Architecture recommendation", items: data },
    { label: "External", state: "Separate commercial dependency", items: external },
  ];
}

function riskRows(model = {}) {
  const direct = list(model.riskMatrix || model.risks);
  if (direct.length) {
    return direct.slice(0, 6).map((row, index) => ({
      type: compact(row.type || row.kind || "Risk", 24),
      title: compact(row.title || row.risk || row.name || `Risk ${index + 1}`, 90),
      evidence: compact(row.evidence || row.detail || row.description || "Proposal evidence", 150),
      impact: compact(row.impact || row.severity || "Medium", 30),
      response: compact(row.response || row.mitigation || row.action || "Confirm owner and mitigation before kickoff.", 150),
    }));
  }
  return list(model.swot).slice(0, 6).map((row) => {
    const kind = compact(Array.isArray(row) ? row[0] : row.kind || row.type || "Risk", 30);
    const detail = compact(Array.isArray(row) ? row[1] : row.detail || row.description || "", 180);
    const opportunity = /strength|opportunity/i.test(kind);
    return {
      type: opportunity ? "Opportunity" : "Risk",
      title: kind,
      evidence: detail || "Proposal-model signal",
      impact: opportunity ? "Positive" : /threat/i.test(kind) ? "High" : "Medium",
      response: opportunity ? "Validate and protect this advantage in acceptance criteria." : "Assign an owner and mitigation before kickoff.",
    };
  });
}

function groupedPriceRows(model = {}, scope = [], projectPrice = 0) {
  const rows = list(model.functionPrice);
  if (!rows.length) {
    return scopeGroups(scope).slice(0, 7).map((group) => ({
      name: group.name,
      features: group.items.map((item) => item.feature).slice(0, 3),
      phase: unique(group.items.map((item) => item.phase)).filter(Boolean).slice(0, 2).join(" · ") || "Sequence to confirm",
      price: null,
    }));
  }
  const groups = new Map();
  for (const row of rows) {
    const key = compact(row.epic || row.group || row.priority || "Functional scope", 80);
    if (!groups.has(key)) groups.set(key, { name: key, features: [], phases: [], price: 0 });
    const group = groups.get(key);
    group.features.push(compact(row.feature || row.name || "Scope item", 90));
    if (row.phase) group.phases.push(compact(row.phase, 40));
    group.price += finiteNumber(row.price ?? row.cost ?? row.total, 0);
  }
  let grouped = [...groups.values()].map((group) => ({
    name: group.name,
    features: unique(group.features).slice(0, 3),
    phase: unique(group.phases).slice(0, 2).join(" · ") || "Cross-phase",
    price: group.price,
  }));
  grouped.sort((a, b) => finiteNumber(b.price) - finiteNumber(a.price));
  if (grouped.length > 7) {
    const extra = grouped.slice(6);
    grouped = [
      ...grouped.slice(0, 6),
      {
        name: "Additional functional scope",
        features: extra.flatMap((group) => group.features).slice(0, 3),
        phase: "Multiple phases",
        price: extra.reduce((sum, group) => sum + finiteNumber(group.price), 0),
      },
    ];
  }
  const sum = grouped.reduce((total, row) => total + finiteNumber(row.price), 0);
  if (projectPrice > 0 && sum === 0) return grouped.map((row) => ({ ...row, price: null }));
  return grouped;
}

function brandPalette(model = {}, theme = DEFAULT_COLORS) {
  const raw = list(model.brandProfile?.colors)
    .map((item) => (typeof item === "string" ? item : item?.hex || item?.color || item?.value))
    .filter(Boolean);
  return unique([
    ...raw.map((color) => safeHex(color, "")).filter(Boolean),
    theme.brand,
    theme.brandDark,
    theme.brandSoft,
    theme.ink,
  ]).slice(0, 5);
}

function teamRows(model = {}) {
  return list(model.teamPlan)
    .map((row) => ({
      role: compact(row.role || row.name || "Delivery role", 80),
      qty: finiteNumber(row.qty ?? row.fte, 0),
      months: finiteNumber(row.months, 0),
      startMonth: Math.max(1, Math.round(finiteNumber(row.startMonth ?? row.start_month ?? row.start, 1))),
      rate: finiteNumber(row.rate, 0),
      total: finiteNumber(row.total ?? row.cost, 0),
    }))
    .filter((row) => row.role)
    .slice(0, 8);
}

function distributeRoundedPercentages(weights = []) {
  const safe = weights.map((weight) => Math.max(0, finiteNumber(weight, 0)));
  const total = safe.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return safe.map((_, index) => (index === safe.length - 1 ? 100 : 0));
  const exact = safe.map((weight) => (weight / total) * 100);
  const values = exact.map(Math.floor);
  let remainder = 100 - values.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) values[order[index % order.length].index] += 1;
  return values;
}

function normalizedPayments(model = {}, projectPrice = 0) {
  const original = list(model.payments).slice(0, 6);
  if (!original.length) {
    return {
      rows: [{ period: "Commercial schedule", percent: 100, amount: projectPrice, due: "Payment milestones to be confirmed before signature", state: "Assumption" }],
      scheduledTotal: projectPrice,
      matchesProject: projectPrice > 0,
    };
  }
  let amounts = original.map((row) => finiteNumber(row.amount, 0));
  if (!amounts.some((amount) => amount > 0) && projectPrice > 0) {
    const suppliedPercentages = original.map((row) => finiteNumber(row.percent, 0));
    const normalized = distributeRoundedPercentages(suppliedPercentages);
    amounts = normalized.map((percent) => Math.round((projectPrice * percent) / 100));
    const delta = projectPrice - amounts.reduce((sum, amount) => sum + amount, 0);
    amounts[amounts.length - 1] += delta;
  }
  const scheduledTotal = amounts.reduce((sum, amount) => sum + amount, 0);
  const percentages = distributeRoundedPercentages(amounts.some((amount) => amount > 0) ? amounts : original.map((row) => finiteNumber(row.percent, 0)));
  return {
    rows: original.map((row, index) => ({
      period: compact(row.period || row.milestone || `Payment ${index + 1}`, 65),
      percent: percentages[index],
      amount: amounts[index],
      due: compact(row.due || row.acceptance || "By accepted milestone", 120),
      state: compact(row.status || "Acceptance-linked", 35),
    })),
    scheduledTotal,
    matchesProject: projectPrice > 0 ? Math.abs(scheduledTotal - projectPrice) < 1 : true,
  };
}

function normalizedRoadmap(model = {}, duration = 3) {
  const months = Math.max(1, Math.round(finiteNumber(duration, 3)));
  const original = list(model.roadmap).map((row, index) => {
    if (Array.isArray(row)) {
      return { period: compact(row[0] || `Month ${index + 1}`, 35), phase: compact(row[1] || "Delivery phase", 70), deliverables: compact(row[2] || "", 150), team: compact(row[3] || "", 100) };
    }
    return {
      period: compact(row.period || row.month || `Month ${index + 1}`, 35),
      phase: compact(row.phase || row.title || "Delivery phase", 70),
      deliverables: compact(row.deliverables || row.detail || row.output || "", 150),
      team: compact(row.team || row.activeTeam || "", 100),
    };
  });
  const periodCount = Math.min(months, 12);
  return Array.from({ length: periodCount }, (_, index) => {
    const startMonth = Math.floor((index * months) / periodCount) + 1;
    const endMonth = Math.floor(((index + 1) * months) / periodCount);
    const period = startMonth === endMonth ? `Month ${startMonth}` : `Months ${startMonth}–${endMonth}`;
    const matchedRows = original.filter((row) => {
      const month = phaseNumber(row.period);
      return Number.isFinite(month) && month >= startMonth && month <= endMonth;
    });
    const matched = matchedRows[0] || original[index];
    if (matched) {
      return {
        period,
        phase: compact(unique(matchedRows.map((row) => row.phase)).join(" → ") || matched.phase, 78),
        deliverables: compact(unique(matchedRows.map((row) => row.deliverables)).join(" · ") || matched.deliverables, 180),
        team: compact(unique(matchedRows.map((row) => row.team)).join(" · ") || matched.team, 120),
        state: "Planned",
      };
    }
    return {
      period,
      phase: "Sequence to confirm",
      deliverables: "Detailed deliverables and acceptance gate are confirmed during kickoff.",
      team: "Proposed delivery team",
      state: "Assumption",
    };
  });
}

function spacedSample(items = [], count = 4) {
  const rows = list(items);
  if (rows.length <= count) return rows;
  return Array.from({ length: count }, (_, index) => {
    const position = Math.round((index * (rows.length - 1)) / Math.max(1, count - 1));
    return rows[position];
  });
}

function trustMoments(scope = [], context = {}) {
  const steps = spacedSample(journeySteps(scope, context), 4);
  const fallbacks = [
    { actor: "Intent", title: "Promise is understood", detail: "The user sees one clear offer, rule, or next action." },
    { actor: "Commit", title: "Decision is recorded", detail: "The platform keeps one accountable state change." },
    { actor: "Delivery", title: "Progress stays visible", detail: "Every owner reads the same status and evidence." },
    { actor: "Resolution", title: "Exceptions retain context", detail: "Support sees the decision trail, not a disconnected ticket." },
  ];
  return Array.from({ length: 4 }, (_, index) => {
    const step = steps[index] || fallbacks[index];
    return {
      actor: compact(step.actor || fallbacks[index].actor, 38),
      title: compact(step.title || fallbacks[index].title, 62),
      detail: compact(step.detail || fallbacks[index].detail, 120),
    };
  });
}

function researchSignals(model = {}, claims = []) {
  const market = model.marketResearch || {};
  const numericClaims = list(claims)
    .filter((claim) => /research|market|evidence/i.test(claim.kind || "") && /\d/.test(claim.claim || ""))
    .slice(0, 3)
    .map((claim) => ({ value: compact((claim.claim.match(/(?:\$|USD\s*)?[\d.,]+\s*(?:%|[KMB]|million|billion)?/i) || ["Evidence"])[0], 28), label: compact(claim.claim, 140), status: claim.id }));
  const trendRows = list(market.trends).slice(0, 4).map((trend, index) => ({
    value: index === 0 ? "01" : `0${index + 1}`,
    label: compact(trend, 140),
    status: "Research signal",
  }));
  return [...numericClaims, ...trendRows]
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.label.toLowerCase() === row.label.toLowerCase()) === index)
    .slice(0, 4);
}

function ownershipBoundary(scope = [], model = {}) {
  const isIntegration = (row) => /payment|bank|sms|email|telegram|integration|external|api|delivery provider|fiscal/i.test(`${row.epic} ${row.feature} ${row.detail}`);
  const isDeferred = (row) => /defer|later|future|phase\s*[2-9]|p[2-9]|out of scope|optional/i.test(`${row.status} ${row.phase} ${row.detail}`);
  const deferredRows = scope.filter(isDeferred);
  const integrationRows = scope.filter((row) => !isDeferred(row) && isIntegration(row));
  const ownedRows = scope.filter((row) => !isDeferred(row) && !isIntegration(row));
  const labels = (rows, fallback) => unique(rows.map((row) => compact(row.feature || row.epic, 48))).slice(0, 4).length
    ? unique(rows.map((row) => compact(row.feature || row.epic, 48))).slice(0, 4)
    : fallback;
  const external = list(model.pricing?.infraExternal).map((row) => compact(row.component || row.name, 48)).filter(Boolean);
  return {
    signals: labels(scope.slice(0, 4), ["User intent", "Business action", "Operational event"]),
    own: labels(ownedRows, ["Core workflow", "Business rules", "State and audit"]),
    integrate: labels(integrationRows, external.length ? external : ["External services", "Provider callbacks"]),
    defer: labels(deferredRows, ["Advanced automation", "Scale-only capabilities"]),
  };
}

function analogRows(model = {}, context = {}) {
  const analogs = list(model.analogResearch).slice(0, 5).map((row) => ({
    name: compact(row.title || sourceDomain(row.url) || "Reference", 52),
    evidence: compact(row.insight || "Reference collected; detailed operating model requires validation.", 170),
    role: /payment|wallet|checkout/i.test(row.insight || "") ? "Transaction rail" : /delivery|courier|fulfil/i.test(row.insight || "") ? "Fulfilment pattern" : /market|seller|catalog/i.test(row.insight || "") ? "Marketplace pattern" : "Product reference",
    decision: /error|unavailable|empty/i.test(row.insight || "") ? "VERIFY" : "LEARN",
  }));
  if (!analogs.length && context.analog) {
    analogs.push({ name: context.analog, evidence: "Client-provided analog. Product mechanics and commercial assumptions remain subject to evidence review.", role: "Client reference", decision: "VERIFY" });
  }
  const validationLenses = [
    { name: "Transaction lens", evidence: "Validate discovery, commitment, status visibility, and exception handling against the supplied reference.", role: "Research plan", decision: "VALIDATE" },
    { name: "Operations lens", evidence: "Validate moderation, fulfilment ownership, service levels, and evidence available to operators.", role: "Research plan", decision: "VALIDATE" },
    { name: "Partner-rail lens", evidence: "Validate which regulated or commodity steps stay with providers and which state remains inside the product.", role: "Research plan", decision: "VALIDATE" },
  ];
  for (const lens of validationLenses) {
    if (analogs.length >= 4) break;
    analogs.push(lens);
  }
  analogs.push({
    name: `${context.focusTitle} MVP`,
    evidence: "Own the core state and acceptance evidence; partner for regulated or commodity rails; defer scale-only bets.",
    role: "Proposed control model",
    decision: "OWN / PARTNER",
  });
  return analogs.slice(0, 6);
}

function swotQuadrants(model = {}) {
  const defaults = {
    Strength: "Scope, team, timeline, and acceptance are controlled in one delivery baseline.",
    Weakness: "Final business rules and client-side owners must be confirmed before kickoff.",
    Opportunity: "A focused digital workflow can remove manual handoffs and expose measurable operating data.",
    Threat: "External dependencies, scope drift, and delayed feedback can move the launch date.",
  };
  const quadrants = new Map(Object.entries(defaults).map(([kind, detail]) => [kind, { kind, details: [detail] }]));
  for (const row of list(model.swot)) {
    const rawKind = compact(Array.isArray(row) ? row[0] : row.kind || row.type || "", 30);
    const detail = compact(Array.isArray(row) ? row[1] : row.detail || row.description || "", 190);
    const kind = Object.keys(defaults).find((label) => new RegExp(label, "i").test(rawKind));
    if (!kind || !detail) continue;
    const current = quadrants.get(kind);
    current.details = current.details[0] === defaults[kind] ? [detail] : unique([...current.details, detail]).slice(0, 3);
  }
  return [...quadrants.values()];
}

function deliverySummary(model = {}, context = {}) {
  const team = teamRows(model);
  const fteMonths = team.reduce((sum, row) => sum + row.qty * row.months, 0);
  const schedule = normalizedPayments(model, context.projectPrice);
  return {
    weeks: Math.max(4, Math.round(context.duration * 4)),
    fteMonths,
    roles: team.length,
    gates: schedule.rows.length,
  };
}

function evidencePill(label, tone = "neutral") {
  return `<span class="evidence-pill evidence-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function pageHeader(label, pageNumber, title, badge = "") {
  return `
    <header class="page-header">
      <div class="page-heading">
        <div class="section-label"><span>${escapeHtml(String(pageNumber).padStart(2, "0"))}</span>${escapeHtml(label)}</div>
        <h2>${escapeHtml(title)}</h2>
      </div>
      ${badge ? `<div class="header-badge">${escapeHtml(badge)}</div>` : ""}
    </header>`;
}

function pageFooter(context, pageNumber) {
  return `
    <footer class="page-footer">
      <span>${escapeHtml(context.portfolioMode ? `${context.title} · Focus: ${context.focusTitle} · Confidential proposal` : `${context.title} · Confidential proposal`)}</span>
      <span>${String(pageNumber).padStart(2, "0")} / ${TOTAL_PAGES}</span>
    </footer>`;
}

function page({ context, number, label, title, badge = "", className = "", body = "" }) {
  return `
  <section class="page ${escapeHtml(className)}" data-page="${number}">
    ${pageHeader(label, number, title, badge)}
    <main class="page-content">${body}</main>
    ${pageFooter(context, number)}
  </section>`;
}

function coverPage({ context, model, theme, scope, evidence, sources }) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const portfolioNames = context.portfolioProjects.map((project) => compact(project.title || "Project", 44)).slice(0, 10);
  const titleClass = titleSizeClass(context.title);
  const scopeConfirmed = hasConfirmedFeatureScope(model, scope);
  const truthRows = [
    ["BRIEF", scopeConfirmed ? "Intent + acceptance" : "Intent + open decisions", evidence.tone],
    ["SCOPE", `${scope.length || finiteNumber(context.project.scope_count, 0)} ${scopeConfirmed ? "controlled" : "proposed"} items`, "neutral"],
    ["EVIDENCE", `${sources.length} sources + ${evidence.label.toLowerCase()}`, evidence.tone],
  ];
  return `
  <section class="page cover-page" data-page="1">
    <header class="cover-header">
      <div class="brand-lockup"><i></i><strong>UDEVS</strong><span>COMMERCIAL KP</span></div>
      <div class="cover-date">${escapeHtml(today)} · 01 / ${TOTAL_PAGES}</div>
    </header>
    <main class="cover-content grid-12">
      <div class="cover-copy">
        <div class="cover-kicker">Commercial proposal · ${escapeHtml(String(today).slice(0, 4))}</div>
        <h1 class="${titleClass}">${escapeHtml(context.title)}</h1>
        <p class="cover-lead">${context.portfolioMode ? `Portfolio context with a detailed commercial baseline for the focus project ${escapeHtml(context.focusTitle)}.` : `A trusted operating system for ${escapeHtml(context.type.toLowerCase())} - connecting product promise, accountable delivery, and commercial acceptance.`}</p>
        <div class="cover-meta">
          <span>${context.portfolioMode ? `Focus project · ${escapeHtml(context.focusTitle)}` : `Client · ${escapeHtml(context.title)}`}</span>
          <span>${context.analog ? `Reference · ${escapeHtml(context.analog)}` : "Reference · to confirm"}</span>
        </div>
        ${portfolioNames.length ? `<div class="portfolio-strip">${portfolioNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : ""}
      </div>
      <aside class="cover-truth">
        <div class="truth-side-label">Shared decision truth</div>
        <div class="truth-rail">
          ${truthRows.map(([label, value, tone]) => `<div class="truth-row truth-${escapeHtml(tone)}"><span>${escapeHtml(label)}</span><i></i><strong>${escapeHtml(value)}</strong></div>`).join("")}
        </div>
      </aside>
    </main>
    <div class="cover-baseline"><span>Prepared by Udevs</span><strong>${escapeHtml(evidence.label)} · ${escapeHtml(`${context.duration} month${context.duration === 1 ? "" : "s"}`)} delivery baseline</strong></div>
    ${pageFooter(context, 1)}
  </section>`;
}

function trustThreadPage({ context, scope }) {
  const moments = trustMoments(scope, context);
  const tones = ["brand", "warning", "brand", "critical"];
  return page({
    context,
    number: 2,
    label: "OPENING THESIS",
    title: "Trust is built once - then carried through every handoff.",
    badge: "One shared transaction truth",
    className: "trust-page",
    body: `
      <p class="page-intro">A product feels reliable when every surface reads and writes the same accountable state - not when each screen looks polished in isolation.</p>
      <div class="trust-thread" style="--trust-count:${moments.length}">
        ${moments.map((moment, index) => `
          <article class="trust-moment trust-${tones[index]}">
            <div class="trust-node"><i></i><span>0${index + 1}</span></div>
            <div class="eyebrow">${escapeHtml(moment.actor)}</div>
            <h3>${escapeHtml(moment.title)}</h3>
            <p>${escapeHtml(moment.detail)}</p>
          </article>`).join("")}
      </div>
      <div class="editorial-conclusion"><span>The thesis</span><strong>Build trust into the operating state - not around it as decoration.</strong></div>`,
  });
}

function whyNowPage({ context, model, scope, claims, evidence }) {
  const signals = researchSignals(model, claims);
  const market = model.marketResearch || {};
  const openQuestions = list(model.groundedBrief?.openQuestions).length;
  const fallbackSignals = [
    { value: `${scope.length}`, label: "scope items mapped into one operating baseline", status: "Scope" },
    { value: `${context.duration} mo`, label: "delivery window requiring explicit acceptance gates", status: "Timeline" },
    { value: `${openQuestions}`, label: "open decisions still visible before kickoff", status: "Decision" },
  ];
  const visible = [...signals, ...fallbackSignals]
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.label.toLowerCase() === row.label.toLowerCase()) === index)
    .slice(0, 3);
  return page({
    context,
    number: 3,
    label: "01 / WHY NOW",
    title: "The market is moving. The operating model must keep up.",
    badge: evidence.label,
    className: "chapter-page",
    body: `
      <div class="chapter-layout">
        <section class="chapter-thesis">
          <div class="chapter-number">01</div>
          <p>${escapeHtml(compact(market.positioning || "The opportunity is real, but a reliable launch depends on one accountable workflow across product, operations, and partner services.", 360))}</p>
          <strong>Controlled handoffs create the position.</strong>
        </section>
        <section class="chapter-signals">
          ${visible.map((signal) => `<article><strong>${escapeHtml(signal.value)}</strong><p>${escapeHtml(signal.label)}</p><span>${escapeHtml(signal.status)}</span></article>`).join("")}
        </section>
      </div>`,
  });
}

function handoffProblemPage({ context, model, scope, narrative }) {
  const steps = trustMoments(scope, context);
  const supplied = list(model.groundedBrief?.openQuestions).map((item) => compact(item, 70));
  const breaks = ["Owner mismatch", "State mismatch", "Dependency gap"].map((fallback, index) => supplied[index] || fallback);
  return page({
    context,
    number: 4,
    label: "THE PROBLEM",
    title: "Truth breaks between systems - not inside a single screen.",
    badge: `${steps.length} surfaces · ${breaks.length} risk handoffs`,
    className: "handoff-page",
    body: `
      <p class="page-intro">${escapeHtml(compact(narrative.problemStatement, 340))}</p>
      <div class="handoff-flow" style="--handoff-count:${steps.length}">
        ${steps.map((step, index) => `
          <div class="handoff-segment">
            <article><span>${escapeHtml(step.actor)}</span><i></i><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.detail)}</small></article>
            ${index < steps.length - 1 ? `<div class="handoff-break"><b>×</b><span>${escapeHtml(breaks[index] || "Context loss")}</span></div>` : ""}
          </div>`).join("")}
      </div>
      <div class="editorial-conclusion"><span>The opportunity</span><strong>Make one operational state visible to every accountable actor - especially when the happy path fails.</strong></div>`,
  });
}

function marketResearchPage({ context, model, claims, sources, evidence }) {
  const market = model.marketResearch || {};
  const signals = researchSignals(model, claims);
  const verifiedSources = sources.filter((source) => /market|analog|research/i.test(source.type)).slice(0, 4);
  const trendRows = list(market.trends).slice(0, 4);
  return page({
    context,
    number: 5,
    label: "MARKET RESEARCH",
    title: "Scale can exist before operating maturity.",
    badge: `${market.sourceCount || verifiedSources.length} research sources`,
    className: "market-research-page",
    body: `
      <div class="market-research-layout">
        <section class="market-evidence-hero">
          <div class="eyebrow">Evidence state</div>
          <strong>${escapeHtml(evidence.label)}</strong>
          <p>${escapeHtml(compact(market.positioning || "The proposal prioritizes a focused launch model before scale-only capabilities.", 300))}</p>
          <div class="market-source-count"><b>${market.sourceCount || verifiedSources.length}</b><span>read research / analog sources</span></div>
        </section>
        <section class="market-research-signals">
          ${(signals.length ? signals : trendRows.map((label, index) => ({ value: `0${index + 1}`, label, status: "Trend" }))).slice(0, 4).map((signal) => `
            <article><div><span>${escapeHtml(signal.status)}</span><strong>${escapeHtml(signal.value)}</strong></div><p>${escapeHtml(signal.label)}</p></article>`).join("") || `<article><p>No verified market signal was supplied. Market claims stay explicitly unconfirmed.</p></article>`}
          <div class="source-chips">${verifiedSources.map((source) => source.href ? `<a href="${escapeHtml(source.href)}">${escapeHtml(source.label)} ↗</a>` : `<span>${escapeHtml(source.label)}</span>`).join("") || "<span>Research source required</span>"}</div>
        </section>
      </div>`,
  });
}

function analogResearchPage({ context, model }) {
  const rows = analogRows(model, context);
  const suppliedCount = list(model.analogResearch).length || (context.analog ? 1 : 0);
  const validationCount = rows.filter((row) => row.decision === "VALIDATE").length;
  return page({
    context,
    number: 7,
    label: "ANALOG RESEARCH",
    title: "Leaders choose different control points.",
    badge: `${suppliedCount} supplied reference${suppliedCount === 1 ? "" : "s"} · ${validationCount} validation lenses`,
    className: "analog-page",
    body: `
      <p class="page-intro">References inform the operating model; they do not become a feature-copy checklist. The decision is what to own, what to partner, and what to postpone.</p>
      <div class="analog-table">
        <div class="analog-head"><span>Reference</span><span>Observed pattern</span><span>Operating role</span><span>Decision</span></div>
        ${rows.map((row, index) => `<div class="analog-row ${index === rows.length - 1 ? "analog-proposed" : ""}"><strong>${escapeHtml(row.name)}</strong><p>${escapeHtml(row.evidence)}</p><span>${escapeHtml(row.role)}</span><b>${escapeHtml(row.decision)}</b></div>`).join("")}
      </div>`,
  });
}

function launchThesisPage({ context, model, scope }) {
  const boundary = ownershipBoundary(scope, model);
  const lanes = [
    ["Signals", "Input events", boundary.signals, "neutral"],
    ["Own", "Core control plane", boundary.own, "brand"],
    ["Integrate", "Licensed partner rails", boundary.integrate, "warning"],
    ["Defer", "Scale-only bets", boundary.defer, "critical"],
  ];
  return page({
    context,
    number: 8,
    label: "LAUNCH THESIS",
    title: "The launch boundary is explicit: own the control state, integrate the rails.",
    badge: "Own · Integrate · Defer",
    className: "boundary-page",
    body: `
      <p class="page-intro">The MVP keeps accountable business state inside the product while regulated, commodity, or provider-owned services remain explicit dependencies.</p>
      <div class="boundary-flow">
        ${lanes.map(([label, title, items, tone], index) => `
          <article class="boundary-lane boundary-${tone}">
            <div class="boundary-top"><span>${escapeHtml(label)}</span><b>0${index + 1}</b></div>
            <h3>${escapeHtml(title)}</h3>
            <ul>${items.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </article>`).join("")}
      </div>
      <div class="editorial-conclusion"><span>Shared rule</span><strong>A partner may execute a step; the product still records the state, owner, SLA, and evidence.</strong></div>`,
  });
}

function productChapterPage({ context, scope }) {
  const moments = trustMoments(scope, context);
  return page({
    context,
    number: 9,
    label: "02 / THE PRODUCT",
    title: "One controlled journey, seen through every surface.",
    badge: `${moments.length} synchronized moments`,
    className: "chapter-page product-chapter-page",
    body: `
      <div class="product-chapter-layout">
        <div class="chapter-number">02</div>
        <p>Every user, operator, and integration stays synchronized because each one reads and writes the same accountable state.</p>
        <div class="product-spine" style="--product-count:${moments.length}">${moments.map((moment, index) => `<article><i></i><span>${escapeHtml(moment.actor)}</span><strong>${escapeHtml(moment.title)}</strong><small>${escapeHtml(moment.detail)}</small></article>`).join("")}</div>
      </div>`,
  });
}

function deliveryChapterPage({ context, model }) {
  const summary = deliverySummary(model, context);
  const schedule = normalizedPayments(model, context.projectPrice);
  const metrics = [
    [context.projectPrice > 0 ? money(context.projectPrice, context.currency) : "TBD", "Investment", "Exact allocation reconciles across scope and team"],
    [`${numberText(summary.fteMonths)} FTE-mo`, "Capacity", `${summary.roles} accountable delivery roles`],
    [`${summary.gates}`, "Controls", "Acceptance-linked commercial gates"],
    [`${schedule.rows.length}`, "Commercial", "Payment milestones tied to outcomes"],
  ];
  return page({
    context,
    number: 15,
    label: "03 / DELIVERY & CLARITY",
    title: "Delivery is a contract between money, team, and proof.",
    badge: `${context.duration} months · ${summary.weeks} weeks`,
    className: "chapter-page delivery-chapter-page",
    body: `
      <div class="delivery-chapter-layout">
        <section><div class="chapter-number">03</div><p>The operating model stays credible when investment, capacity, dependencies, and acceptance are visible in the same plan.</p></section>
        <aside><strong>${context.duration}</strong><span>months</span><strong>${summary.weeks}</strong><span>weeks</span></aside>
      </div>
      <div class="delivery-metrics">${metrics.map(([value, label, detail]) => `<article><i></i><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><p>${escapeHtml(detail)}</p></article>`).join("")}</div>`,
  });
}

function closePage({ context, model, sources, scope }) {
  const schedule = normalizedPayments(model, context.projectPrice);
  const brandReady = Boolean(model.groundedBrief?.brandReference?.url?.value || (model.brandProfile?.url && !/not provided|failed|unknown/i.test(String(model.brandProfile?.sourceStatus || ""))));
  const external = architectureLayers(scope, model).find((layer) => layer.label === "External")?.items || [];
  const decisions = [
    ["Launch scope", `${scope.length} items + explicit ownership boundary`, "Executive sponsor", "Before kickoff", hasConfirmedFeatureScope(model, scope) ? "READY" : "OPEN"],
    ["Brand system", brandReady ? "Confirmed brand source applied" : "Brandbook / source approval required", "Brand owner", "By week 1", brandReady ? "READY" : "OPEN"],
    ["Payment gates", `${schedule.rows.length} milestones + acceptance wording`, "Finance / legal", "By week 1", schedule.matchesProject ? "READY" : "OPEN"],
    ["Dependencies", `${external.length} external rails + accountable owners`, "Product / operations", "Before build", "OPEN"],
  ];
  return page({
    context,
    number: 21,
    label: "CLOSE / SIGN-OFF",
    title: "Four client decisions unlock kickoff.",
    badge: `${sources.length} evidence sources retained`,
    className: "close-page",
    body: `
      <p class="page-intro">Name one accountable owner for each decision. Udevs can then mobilize against a single approved commercial baseline.</p>
      <div class="decision-table">
        <div class="decision-head"><span>Decision</span><span>What is approved</span><span>Owner</span><span>Due</span><span>Status</span></div>
        ${decisions.map((row) => `<div class="decision-row"><strong>${escapeHtml(row[0])}</strong><p>${escapeHtml(row[1])}</p><span>${escapeHtml(row[2])}</span><span>${escapeHtml(row[3])}</span><b class="decision-${row[4].toLowerCase()}">${escapeHtml(row[4])}</b></div>`).join("")}
      </div>
      <div class="close-cta"><span>Next action</span><strong>Approve proposal → name owners → confirm kickoff</strong></div>
      <div class="close-sources"><span>Evidence register</span><p>${sources.slice(0, 5).map((source) => escapeHtml(source.domain || source.label)).join(" · ") || "Client brief · source register pending"}</p></div>`,
  });
}

function executivePage({ context, model, narrative, claims, evidence }) {
  const differentiators = narrative.differentiators.length
    ? narrative.differentiators
    : [
        "Explicit scope is separated from recommendations.",
        "Commercial totals remain tied to the deterministic estimate.",
        "Unknown inputs remain visible before approval.",
      ];
  const visibleClaims = claims.slice(0, 5);
  const portfolio = context.portfolioMode
    ? `<div class="portfolio-list">${context.portfolioProjects.slice(0, 10).map((project) => `<span>${escapeHtml(compact(project.title || "Project", 60))}</span>`).join("")}</div>`
    : "";
  return page({
    context,
    number: 2,
    label: "EXECUTIVE SUMMARY",
    title: "Decision brief.",
    badge: evidence.label,
    className: "editorial-page",
    body: `
      <div class="editorial-split">
        <section class="summary-thesis">
          <div class="eyebrow">Executive commercial summary</div>
          <p class="statement">${escapeHtml(narrative.executiveSummary)}</p>
          <div class="decision-list">
            ${differentiators.slice(0, 4).map((item, index) => `<div><span>0${index + 1}</span><p>${escapeHtml(item)}</p></div>`).join("")}
          </div>
          ${portfolio}
        </section>
        <aside class="evidence-ledger panel commercial-data">
          <div class="eyebrow">Claim ledger</div>
          ${visibleClaims.length ? visibleClaims.map((claim) => `
            <div class="claim-row">
              <div><strong>${escapeHtml(claim.claim)}</strong><span>${escapeHtml(claim.id)} · ${escapeHtml(claim.kind.replaceAll("_", " "))}</span></div>
              ${evidencePill(claim.status.replaceAll("_", " "), /explicit|verified/.test(claim.status) ? "positive" : /assum/.test(claim.status) ? "warning" : "neutral")}
            </div>`).join("") : `<div class="empty-state"><strong>No claim ledger supplied.</strong><span>Statements remain proposal assumptions until source IDs are attached.</span></div>`}
        </aside>
      </div>`,
  });
}

function problemSolutionPage({ context, model, narrative }) {
  const openQuestions = list(model.groundedBrief?.openQuestions).map((item) => compact(item, 180)).slice(0, 4);
  const conditions = narrative.differentiators.length ? narrative.differentiators.slice(0, 3) : [
    "Owners and acceptance gates are explicit.",
    "Dependencies are visible before implementation.",
    "Committed scope stays separate from recommendations.",
  ];
  return page({
    context,
    number: 3,
    label: "PROBLEM & SOLUTION",
    title: openQuestions.length ? "From an open brief to an approved delivery baseline." : "From operational friction to measurable outcome.",
    badge: openQuestions.length ? `${openQuestions.length} open questions` : "Decision-ready narrative",
    className: "editorial-page",
    body: `
      <div class="problem-arc">
        <article class="arc-block arc-problem">
          <div class="arc-index">01</div><div class="eyebrow">Problem</div>
          <p>${escapeHtml(narrative.problemStatement)}</p>
        </article>
        <div class="arc-arrow">→</div>
        <article class="arc-block arc-solution">
          <div class="arc-index">02</div><div class="eyebrow">Proposed solution</div>
          <p>${escapeHtml(narrative.solutionNarrative)}</p>
        </article>
        <div class="arc-arrow">→</div>
        <article class="arc-block arc-outcome">
          <div class="arc-index">03</div><div class="eyebrow">Acceptance outcome</div>
          <ul>${conditions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </article>
      </div>
      <div class="question-rail">
        <div><span>Evidence state</span><strong>${escapeHtml(narrative.status.replaceAll("_", " "))}</strong></div>
        <div class="question-copy"><span>Open decisions</span><p>${openQuestions.length ? escapeHtml(openQuestions.join(" · ")) : "No unresolved brief questions were supplied; final acceptance criteria still require client approval."}</p></div>
      </div>`,
  });
}

function marketPage({ context, model, sources }) {
  const market = model.tamSamSom || {};
  const values = [finiteNumber(market.tam, 0), finiteNumber(market.sam, 0), finiteNumber(market.som, 0)];
  const max = Math.max(...values, 1);
  const hasSizing = values.some((value) => value > 0);
  const marketSources = list(market.sources).length ? list(market.sources) : sources.filter((source) => /market|analog|research/i.test(source.type));
  const researchStatus = String(model.researchStatus?.status || model.validation?.researchStatus || "");
  const scenario = !hasSizing || !marketSources.length || /offline|limited/i.test(researchStatus);
  const promptSourceIds = new Set(list(model.sources).filter((source) => /client_brief/i.test(source.type || "")).map((source) => source.id));
  const verifiedMarketSignals = claimLedgerFromModel(model)
    .filter((claim) => /research/i.test(claim.kind) && claim.sourceIds.some((id) => !promptSourceIds.has(id)) && /\d|million|billion|growth|market|seller|delivery/i.test(claim.claim))
    .slice(0, 2);
  const labels = ["TAM", "SAM", "SOM"];
  const descriptions = ["Total addressable scenario", "Serviceable segment", "Obtainable first target"];
  return page({
    context,
    number: 6,
    label: "TAM / SAM / SOM",
    title: "Market scenario, assumptions, and proof.",
    badge: hasSizing ? "Source-backed sizing" : verifiedMarketSignals.length ? "Market evidence · sizing pending" : "Market hypothesis to validate",
    className: "analytics-page",
    body: `
      <div class="market-layout">
        <section class="market-bars commercial-data">
          ${labels.map((label, index) => `
            <div class="market-row">
              <div><span>${label}</span><small>${descriptions[index]}</small></div>
              <div class="market-track ${values[index] > 0 ? "" : "market-track-empty"}">${values[index] > 0 ? `<i style="width:${Math.max(8, Math.round((values[index] / max) * 100))}%"></i>` : "<em>Hypothesis pending</em>"}</div>
              <strong>${values[index] > 0 ? escapeHtml(money(values[index], context.currency)) : "Not confirmed"}</strong>
            </div>`).join("")}
        </section>
        <aside class="market-assumptions panel">
          <div class="eyebrow">Formula and assumptions</div>
          <p class="formula">${escapeHtml(compact(market.formula || "Market sizing remains a hypothesis until geography, segment, and sales capacity are confirmed.", 300))}</p>
          ${verifiedMarketSignals.length ? `<div class="market-signals"><div class="eyebrow">Verified market signals</div>${verifiedMarketSignals.map((claim) => `<div><strong>${escapeHtml(claim.claim)}</strong><span>${escapeHtml(claim.id)} · ${escapeHtml(claim.sourceIds.join(", "))}</span></div>`).join("")}</div>` : ""}
          <ul>${list(market.assumptions).slice(0, 4).map((item) => `<li>${escapeHtml(compact(item, 160))}</li>`).join("") || "<li>No market assumptions were supplied.</li>"}</ul>
          <div class="source-chips">${marketSources.slice(0, 4).map((source) => {
            const label = source.label || sourceDomain(source.source || source.url || source.domain || "");
            const href = safeSourceHref(source.source || source.url || source.sourceRef || "");
            return href ? `<a href="${escapeHtml(href)}">${escapeHtml(safeSourceLabel(label))} ↗</a>` : `<span>${escapeHtml(safeSourceLabel(label))}</span>`;
          }).join("") || "<span>Validation source required</span>"}</div>
        </aside>
      </div>`,
  });
}

function productMapPage({ context, model, scope }) {
  const boundary = ownershipBoundary(scope, model);
  const layers = architectureLayers(scope, model);
  const surfaces = layers.find((layer) => layer.label === "Channels")?.items || ["Primary product surface"];
  const domainLayers = [
    ["Surfaces", "Who reads and writes the state", surfaces, "brand"],
    ["Owned core", "The accountable business truth", boundary.own, "brand"],
    ["Partner rails", "Licensed or commodity execution", boundary.integrate, "warning"],
  ];
  const scopeConfirmed = hasConfirmedFeatureScope(model, scope);
  return page({
    context,
    number: 10,
    label: "PRODUCT MIND MAP",
    title: "Every surface writes to the same accountable core.",
    badge: `${scope.length} ${scopeConfirmed ? "scope" : "proposed"} items`,
    className: "schematic-page",
    body: `
      <div class="domain-map">
        <aside class="domain-index"><span>Product mind map${context.portfolioMode ? " · focus project" : ""}</span><strong>${escapeHtml(context.focusTitle)}</strong><p>${scope.length} ${scopeConfirmed ? "controlled" : "proposed"} items across one state model.</p></aside>
        <section class="domain-layers">
          ${domainLayers.map(([label, detail, items, tone], index) => `
            <article class="domain-layer domain-${tone}">
              <div><span>0${index + 1}</span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></div>
              <section>${items.slice(0, 5).map((item) => `<b>${escapeHtml(item)}</b>`).join("")}</section>
            </article>`).join("")}
          <div class="domain-truth">Shared state · permissions · audit evidence · acceptance ownership</div>
        </section>
      </div>`,
  });
}

function journeyPage({ context, model, scope }) {
  const steps = journeySteps(scope, context);
  const openQuestions = list(model.groundedBrief?.openQuestions).map((item) => compact(item, 160)).slice(0, 3);
  const actors = unique(steps.map((step) => step.actor)).slice(0, 5);
  const decisionIndex = Math.max(1, Math.min(steps.length - 2, Math.floor(steps.length / 2)));
  return page({
    context,
    number: 12,
    label: "BPMN / USER FLOW",
    title: "Primary journey with accountable hand-offs.",
    badge: `${steps.length} connected steps`,
    className: "schematic-page",
    body: `
      <div class="bpmn-shell" style="--bpmn-steps:${steps.length}">
        <div class="bpmn-head"><span>Actor</span><div>${steps.map((step, index) => `<b>0${index + 1}</b>`).join("")}</div></div>
        ${actors.map((actor) => `
          <div class="bpmn-lane">
            <strong>${escapeHtml(actor)}</strong>
            <div class="bpmn-track">${steps.map((step, index) => step.actor === actor ? `<article class="${index === decisionIndex ? "bpmn-decision" : ""}"><span>${index === decisionIndex ? "Decision" : escapeHtml(step.status)}</span><b>${escapeHtml(step.title)}</b><small>${escapeHtml(step.detail)}</small></article>` : `<i></i>`).join("")}</div>
          </div>`).join("")}
      </div>
      <div class="bpmn-outcomes"><div><span>YES / CONTINUE</span><strong>${escapeHtml(steps[Math.min(decisionIndex + 1, steps.length - 1)]?.title || "Proceed to the next accountable state")}</strong></div><div><span>NO / EXCEPTION</span><strong>${openQuestions.length ? escapeHtml(openQuestions.join(" · ")) : "Retry, manual review, and escalation ownership are approved in discovery."}</strong></div></div>`,
  });
}

function architecturePage({ context, model, scope }) {
  const layers = architectureLayers(scope, model);
  return page({
    context,
    number: 13,
    label: "INFRASTRUCTURE DIAGRAM",
    title: "Solution layers and external dependencies.",
    badge: "Responsibility map",
    className: "schematic-page",
    body: `
      <div class="architecture-stack">
        ${layers.map((layer, layerIndex) => `
          <section class="architecture-layer">
            <div class="layer-label"><span>0${layerIndex + 1}</span><strong>${escapeHtml(layer.label)}</strong><small>${escapeHtml(layer.state)}</small></div>
            <div class="layer-nodes" style="--nodes:${clamp(layer.items.length, 1, 5)}">
              ${layer.items.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
            </div>
          </section>`).join("")}
      </div>
      <div class="architecture-note"><strong>Security boundary</strong><span>Identity, permissions, auditability, backup, and production access require explicit architecture approval before launch.</span></div>`,
  });
}

function swotPage({ context, model }) {
  const rows = swotQuadrants(model);
  const responses = {
    Strength: "Protect this advantage in acceptance criteria and delivery ownership.",
    Weakness: "Close the missing input, assign an owner, and time-box the decision.",
    Opportunity: "Test the highest-value signal early and measure it after launch.",
    Threat: "Create a fallback path before the dependency reaches the critical path.",
  };
  return page({
    context,
    number: 14,
    label: "SWOT ANALYSIS",
    title: "The opportunity is real; execution quality decides the outcome.",
    badge: "Internal × External · Helpful × Harmful",
    className: "analytics-page",
    body: `
      <div class="swot-axis-labels"><span>Helpful</span><span>Harmful</span></div>
      <div class="swot-matrix commercial-data">
        ${rows.map((row) => `
          <article class="swot-quadrant swot-${escapeHtml(row.kind.toLowerCase())}">
            <div><span>${/strength|weakness/i.test(row.kind) ? "Internal" : "External"}</span><strong>${escapeHtml(row.kind)}</strong></div>
            <ul>${row.details.slice(0, 3).map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>
            <p><span>Operating response</span>${escapeHtml(responses[row.kind])}</p>
          </article>`).join("")}
      </div>`,
  });
}

function functionPricePage({ context, model, scope }) {
  const groups = groupedPriceRows(model, scope, context.projectPrice);
  const maxPrice = Math.max(...groups.map((group) => finiteNumber(group.price, 0)), 1);
  const scaleMax = Math.max(5_000, Math.ceil(maxPrice / 5_000) * 5_000);
  const allocated = groups.reduce((sum, group) => sum + finiteNumber(group.price, 0), 0);
  const reconciled = context.projectPrice > 0 ? Math.abs(allocated - context.projectPrice) < 1 : allocated > 0;
  return page({
    context,
    number: 16,
    label: "FUNCTION PRICE",
    title: "Indicative scope allocation by functional group.",
    badge: reconciled ? "Budget allocation scenario" : "Allocation to confirm",
    className: "analytics-page",
    body: `
      <div class="price-summary commercial-data"><span>${context.portfolioMode ? `Focus project investment · ${escapeHtml(context.focusTitle)}` : "Project investment"}${context.currencyStatus === "assumed" ? ` · ${escapeHtml(context.currency)} assumed` : ""}</span><strong>${context.projectPrice > 0 ? escapeHtml(money(context.projectPrice, context.currency)) : "To confirm"}</strong><small>${groups.length} groups · common scale 0-${escapeHtml(money(scaleMax, context.currency))}</small></div>
      <div class="function-price-list commercial-data">
        ${groups.length ? groups.map((group) => `
          <div class="function-price-row">
            <div><strong>${escapeHtml(group.name)}</strong><span>${escapeHtml(group.features.join(" · ") || "Scope detail pending")}</span></div>
            <div><span>${escapeHtml(group.phase)}</span><i style="--bar:${Math.max(4, Math.round((finiteNumber(group.price, 0) / scaleMax) * 100))}%"></i></div>
            <b>${group.price === null ? "TBD" : escapeHtml(money(group.price, context.currency))}</b>
          </div>`).join("") : `<div class="empty-state panel"><strong>Functional allocation pending.</strong><span>The project total remains visible; group-level pricing needs an approved estimate.</span></div>`}
      </div>
      <div class="reconcile-note ${reconciled ? "note-positive" : "note-warning"}"><strong>${reconciled ? "Indicative allocation reconciles to the supplied budget." : "Function-level allocation does not yet match the project price."}</strong><span>${allocated > 0 ? escapeHtml(`Validate effort and rates after discovery · visible allocation: ${money(allocated, context.currency)}${context.currencyStatus === "assumed" ? ` · ${context.currency} assumed` : ""}`) : "No deterministic function prices supplied."}</span></div>`,
  });
}

function designPage({ context, model, theme }) {
  const palette = brandPalette(model, theme);
  const explicitBrandReference = Boolean(model.groundedBrief?.brandReference?.url?.value);
  const profiledBrandSource = Boolean(model.brandProfile?.url) && !/not provided|failed|unknown/i.test(String(model.brandProfile?.sourceStatus || ""));
  const brandConfirmed = explicitBrandReference || profiledBrandSource;
  const analogInspired = !brandConfirmed && Boolean(context.analog) && list(model.brandProfile?.colors).length > 0;
  const directionLabel = brandConfirmed ? "Brand evidence applied" : analogInspired ? "Analog-inspired palette" : "Unbranded direction";
  const fonts = list(model.brandProfile?.fonts)
    .map((font) => compact(font, 60))
    .filter((font) => !/not confirmed|unknown/i.test(font))
    .slice(0, 3);
  const stages = list(model.designProject).slice(0, 4);
  return page({
    context,
    number: 11,
    label: "DESIGN PROJECT",
    title: "Visual system and approval path.",
    badge: directionLabel,
    className: "editorial-page",
    body: `
      <div class="design-layout">
        <section class="design-system panel-dark">
          <div class="eyebrow">${brandConfirmed ? "Brand-derived direction" : analogInspired ? "Reference-inspired direction" : "Unbranded direction · assumption"}</div>
          <h3>${escapeHtml(compact(model.brandProfile?.tone || "Evidence editorial", 70))}</h3>
          <p>${brandConfirmed ? "Confirmed brand inputs are normalized for contrast and applied to the proposal system." : analogInspired ? "The accent palette is sampled from the product analog for this concept only; it is not presented as the client's confirmed brand system." : "No confirmed brandbook or product-site source was supplied. The default Udevs editorial system is used without claiming client-brand fidelity."}</p>
          <div class="palette-row">${palette.map((color) => `<div><i style="background:${color}"></i><span>${escapeHtml(color)}</span></div>`).join("")}</div>
          <div class="type-specimen"><span>Aa</span><div><strong>${fonts.length ? escapeHtml(fonts.join(" · ")) : "Offline system sans"}</strong><small>System sans + system mono metadata</small></div></div>
        </section>
        <section class="design-stages">
          ${(stages.length ? stages : [
            ["Discovery", "Brand source, product goals, user roles, and core flows"],
            ["UX", "Information architecture, journeys, and approval-ready wireframes"],
            ["UI", "Responsive components, states, and visual hierarchy"],
            ["Approval", "Client review, corrections, and final handoff"],
          ]).map((row, index) => {
            const title = Array.isArray(row) ? row[0] : row.stage || row.title;
            const detail = Array.isArray(row) ? row[1] : row.output || row.detail;
            const honestDetail = !brandConfirmed && /brand-applied/i.test(String(detail || ""))
              ? String(detail).replace(/brand-applied/ig, analogInspired ? "Reference-inspired" : "Unbranded")
              : detail;
            return `<article><span>0${index + 1}</span><div><strong>${escapeHtml(compact(title, 45))}</strong><p>${escapeHtml(compact(honestDetail, 180))}</p></div></article>`;
          }).join("")}
        </section>
      </div>`,
  });
}

function teamPage({ context, model }) {
  const rows = teamRows(model);
  const months = clamp(context.duration, 1, 12);
  const teamTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const monthlyTotals = Array.from({ length: months }, (_, index) => rows.reduce((sum, row) => {
    const month = index + 1;
    const active = month >= row.startMonth && month < row.startMonth + row.months;
    return sum + (active ? row.qty : 0);
  }, 0));
  const fteMonths = rows.reduce((sum, row) => sum + row.qty * row.months, 0);
  const peak = Math.max(...monthlyTotals, 0);
  return page({
    context,
    number: 17,
    label: "TEAM SIZE",
    title: "Indicative delivery team across the timeline.",
    badge: `${rows.length} roles · ${numberText(fteMonths)} FTE-months · scenario`,
    className: "analytics-page",
    body: `
      <div class="team-table commercial-data" style="--months:${months}">
        <div class="team-head"><span>Role / FTE</span><div>${Array.from({ length: months }, (_, index) => `<b>M${index + 1}</b>`).join("")}</div><span>Cost</span></div>
        ${rows.length ? rows.map((row) => `
          <div class="team-row">
            <div><strong>${escapeHtml(row.role)}</strong><span>${escapeHtml(`${numberText(row.qty)} FTE · ${numberText(row.months)} months`)}</span></div>
            <div class="team-timeline">
              ${Array.from({ length: months }, (_, index) => {
                const remaining = row.months - ((index + 1) - row.startMonth);
                if (index + 1 < row.startMonth) return `<i class="inactive"></i>`;
                const state = remaining >= 1 ? "active" : remaining > 0 ? "partial" : "inactive";
                return `<i class="${state}"><span>${state === "inactive" ? "" : escapeHtml(numberText(row.qty))}</span></i>`;
              }).join("")}
            </div>
            <b>${escapeHtml(money(row.total, context.currency))}</b>
          </div>`).join("") : `<div class="empty-state panel"><strong>Team estimate pending.</strong><span>Roles and allocation must be approved against the scope baseline.</span></div>`}
      </div>
      <div class="team-month-total commercial-data" style="--months:${months}"><strong>Monthly FTE</strong><div>${monthlyTotals.map((value) => `<b class="${value === peak ? "peak" : ""}">${escapeHtml(numberText(value))}</b>`).join("")}</div><span>Peak ${escapeHtml(numberText(peak))}</span></div>
      <div class="team-total commercial-data"><span>Indicative team allocation</span><strong>${escapeHtml(money(teamTotal, context.currency))}</strong><small>${escapeHtml(`${numberText(fteMonths)} FTE-months · monthly starts are a delivery scenario until staffing dates are approved`)}</small></div>`,
  });
}

function projectPricePage({ context, model }) {
  const scopeConfirmed = hasConfirmedFeatureScope(model, normalizedScope(model, context.project));
  const exclusions = list(model.pricing?.exclusions).map((item) => compact(item, 90)).slice(0, 6);
  const external = list(model.pricing?.infraExternal).slice(0, 6).map((row) => ({
    component: compact(row.component || row.name || "External item", 60),
    type: compact(`${row.type || row.period || "External"}${row.sourceId || /verified|explicit|quoted/i.test(String(row.status || "")) ? "" : " · unquoted"}`, 55),
    cost: row.sourceId || /verified|explicit|quoted/i.test(String(row.status || "")) ? compact(row.cost || row.amount || "To confirm", 45) : "To confirm",
  }));
  return page({
    context,
    number: 19,
    label: "PROJECT PRICE",
    title: "Commercial terms and external costs.",
    badge: external.length ? "External costs to confirm" : "Development scenario",
    className: "commercial-page",
    body: `
      <div class="commercial-layout commercial-data">
        <section class="investment-panel panel-dark">
          <div class="eyebrow">Project investment</div>
          <strong>${context.projectPrice > 0 ? escapeHtml(money(context.projectPrice, context.currency)) : "To confirm"}</strong>
          <p>${scopeConfirmed ? "Development scope, delivery team, QA, release preparation, and acceptance management as defined in this proposal." : "Planning envelope for the proposed delivery scenario; final scope and role allocation require discovery approval."}</p>
          <div class="terms-grid"><span><b>Currency</b>${escapeHtml(`${context.currency}${context.currencyStatus === "assumed" ? " · assumed" : ""}`)}</span><span><b>Tax</b>Confirm before signature</span><span><b>Validity</b>Confirm in final offer</span></div>
        </section>
        <section class="external-card panel">
          <div class="eyebrow">External / recurring items</div>
          ${external.length ? `<p class="external-note">No source-backed provider quote is attached; validate provider, region, usage tier, and tax.</p>` : ""}
          ${external.length ? external.map((row) => `<div class="external-row"><div><strong>${escapeHtml(row.component)}</strong><span>${escapeHtml(row.type)}</span></div><b>${escapeHtml(row.cost)}</b></div>`).join("") : `<div class="empty-state"><strong>No external-cost model supplied.</strong><span>Hosting, licenses, APIs, and hardware remain outside the confirmed development total until listed.</span></div>`}
        </section>
        <section class="exclusion-card panel">
          <div class="eyebrow">Exclusions / confirmation items</div>
          <ul>${exclusions.length ? exclusions.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>Third-party fees and usage growth require confirmation.</li><li>Taxes, legal terms, and currency treatment require confirmation.</li>"}</ul>
        </section>
      </div>`,
  });
}

function paymentPage({ context, model }) {
  const schedule = normalizedPayments(model, context.projectPrice);
  let cumulativeAmount = 0;
  let cumulativePercent = 0;
  const rows = schedule.rows.map((row) => {
    const exactPercent = context.projectPrice > 0
      ? (row.amount / context.projectPrice) * 100
      : row.percent;
    cumulativeAmount += row.amount;
    cumulativePercent += exactPercent;
    return { ...row, exactPercent, cumulativeAmount, cumulativePercent };
  });
  return page({
    context,
    number: 20,
    label: "PAYMENT STAGES / SCHEDULE",
    title: context.currencyStatus === "assumed" ? "Indicative payment gates tied to acceptance." : "Payment gates tied to acceptance.",
    badge: context.currencyStatus === "assumed" ? `100% scheduled · ${context.currency} assumed` : "100% scheduled",
    className: "commercial-page",
    body: `
      <p class="page-intro">The first invoice mobilizes the team; every later invoice is tied to evidence the client can accept.</p>
      <div class="payment-table commercial-data">
        <div class="payment-head"><span>Milestone</span><span>Acceptance trigger</span><span>Amount</span><span>Cumulative</span></div>
        ${rows.map((row, index) => `
          <div class="payment-row">
            <div><i class="payment-tone-${(index % 4) + 1}"></i><span>0${index + 1}</span><strong>${escapeHtml(row.period)}</strong></div>
            <p>${escapeHtml(row.due)}</p>
            <b>${escapeHtml(money(row.amount, context.currency))}<small>${escapeHtml(numberText(row.exactPercent, 2))}%</small></b>
            <b>${escapeHtml(money(row.cumulativeAmount, context.currency))}<small>${escapeHtml(numberText(index === rows.length - 1 ? 100 : row.cumulativePercent, 2))}%</small></b>
          </div>`).join("")}
      </div>
      <div class="payment-total ${schedule.matchesProject ? "note-positive" : "note-warning"}">
        <div><span>Scheduled total</span><strong>${escapeHtml(money(schedule.scheduledTotal, context.currency))}</strong></div>
        <p>${schedule.matchesProject ? "Payment amounts reconcile to the project investment. Rounded display percentages are normalized to exactly 100%." : "Payment amounts do not reconcile to the project investment. Resolve the difference before signature; percentages still describe the visible schedule as 100%."}</p>
      </div>`,
  });
}

function roadmapPage({ context, model }) {
  const scopeConfirmed = hasConfirmedFeatureScope(model, normalizedScope(model, context.project));
  const roadmap = normalizedRoadmap(model, context.duration).map((row) => scopeConfirmed ? row : { ...row, state: "Scenario" });
  const weekMode = context.duration <= 6;
  const units = weekMode ? Math.max(4, Math.round(context.duration * 4)) : Math.max(1, Math.round(context.duration));
  const unitLabels = Array.from({ length: units }, (_, index) => `${weekMode ? "W" : "M"}${index + 1}`);
  const planned = roadmap.map((row, index) => {
    const start = Math.floor((index * units) / Math.max(1, roadmap.length)) + 1;
    const end = Math.max(start, Math.floor(((index + 1) * units) / Math.max(1, roadmap.length)));
    return { ...row, start, span: Math.max(1, end - start + 1), end };
  });
  return page({
    context,
    number: 18,
    label: "ROADMAP",
    title: `${planned.length} acceptance gates control the ${units}-${weekMode ? "week" : "month"} delivery.`,
    badge: `${scopeConfirmed ? "Planned" : "Scenario"} · ${unitLabels[0]}-${unitLabels.at(-1)}`,
    className: "schematic-page",
    body: `
      <p class="page-intro">Payment, scope, and fulfilment decisions are locked to visible acceptance outcomes - not calendar progress alone.</p>
      <div class="gantt-chart commercial-data" style="--road-units:${units}">
        <div class="gantt-head"><span>Workstream / acceptance</span><div>${unitLabels.map((label) => `<b>${escapeHtml(label)}</b>`).join("")}</div></div>
        ${planned.map((row, index) => `
          <div class="gantt-row">
            <div><span>0${index + 1} · ${escapeHtml(row.period)}</span><strong>${escapeHtml(row.phase)}</strong><small>${escapeHtml(row.deliverables)}</small></div>
            <div class="gantt-track"><i class="gantt-tone-${(index % 4) + 1}" style="--start:${row.start};--span:${row.span}"></i><b style="--gate:${row.end}"></b></div>
          </div>`).join("")}
      </div>
      <div class="gantt-gates">${planned.slice(0, 4).map((row) => `<span>${escapeHtml(`${unitLabels[row.end - 1]} · ${row.phase}`)}</span>`).join("")}</div>`,
  });
}

function sourcesPage({ context, model, sources, claims }) {
  const visible = sources.slice(0, 10);
  const additional = Math.max(0, sources.length - visible.length);
  const grouped = visible.reduce((map, source) => {
    if (!map.has(source.type)) map.set(source.type, []);
    map.get(source.type).push(source);
    return map;
  }, new Map());
  return page({
    context,
    number: 15,
    label: "APPENDIX / SOURCES",
    title: "Evidence register and approval path.",
    badge: `${sources.length} sources · ${claims.length} claims`,
    className: "sources-page",
    body: `
      <div class="sources-layout source-data">
        <section class="source-register panel">
          ${grouped.size ? [...grouped.entries()].map(([type, rows]) => `
            <div class="source-group">
              <div class="source-group-title"><strong>${escapeHtml(type)}</strong><span>${rows.length}</span></div>
              ${rows.map((source) => `
                <div class="source-entry">
                  <span>${escapeHtml(source.id)}</span>
                  <div>${source.href ? `<a href="${escapeHtml(source.href)}">${escapeHtml(source.label)} ↗</a>` : `<strong>${escapeHtml(source.label)}</strong>`}<small>${escapeHtml(source.domain)} · ${escapeHtml(source.status)}</small></div>
                </div>`).join("")}
            </div>`).join("") : `<div class="empty-state"><strong>No source register supplied.</strong><span>All proposal claims remain assumptions until evidence IDs are attached.</span></div>`}
          ${additional ? `<div class="source-more">+${additional} additional curated sources remain in the evidence bundle.</div>` : ""}
        </section>
        <aside class="approval-card panel-dark">
          <div class="eyebrow">Next decision</div>
          <h3>Approve the evidence baseline before delivery starts.</h3>
          <ol><li>Resolve open questions and unknowns.</li><li>Approve scope, investment, and payment gates.</li><li>Confirm owners, kickoff date, and acceptance rhythm.</li></ol>
          <div class="signature-grid"><span>Udevs representative</span><span>Client representative</span></div>
          <div class="approval-cta">Confirm scope → approve commercials → kickoff</div>
        </aside>
      </div>`,
  });
}

function styles(theme) {
  return `
    @page { size: 1440px 960px; margin: 0; }
    * { box-sizing: border-box; }
    :root {
      --canvas: ${theme.canvas};
      --paper: ${theme.paper};
      --ink: ${theme.ink};
      --ink-2: ${theme.ink2};
      --muted: ${theme.muted};
      --quiet: ${theme.quiet};
      --rule: ${theme.rule};
      --brand: ${theme.brand};
      --brand-dark: ${theme.brandDark};
      --brand-soft: ${theme.brandSoft};
      --brand-on: ${theme.brandOn};
      --brand-dark-on: ${theme.brandDarkOn};
      --positive: ${theme.positive};
      --warning: ${theme.warning};
      --critical: ${theme.critical};
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 18px;
      --shadow: none;
      --font-display: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      --font-text: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    html, body { margin: 0; background: var(--canvas); color: var(--ink); font-family: var(--font-text); }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1, h2, h3, p, dl, dd, dt, ul, ol { margin: 0; }
    ul, ol { padding: 0; }
    .page {
      width: 1440px;
      height: 960px;
      padding: 46px 64px 34px;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 18px;
      background:
        radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--brand) 11%, transparent) 0, transparent 34%),
        var(--canvas);
      page-break-after: always;
      overflow: clip;
    }
    .page:nth-of-type(4n + 2) { background: radial-gradient(circle at 14% 14%, color-mix(in srgb, var(--brand) 8%, transparent) 0, transparent 32%), var(--canvas); }
    .page:nth-of-type(4n + 3) { background: radial-gradient(circle at 82% 78%, color-mix(in srgb, var(--warning) 6%, transparent) 0, transparent 35%), var(--canvas); }
    .page:nth-of-type(4n) { background: linear-gradient(122deg, var(--canvas) 0 68%, color-mix(in srgb, var(--brand-soft) 46%, var(--canvas)) 100%); }
    .page:last-child { page-break-after: auto; }
    .page-content { min-height: 0; }
    .grid-12 { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 20px; }
    .panel, .panel-dark { min-width: 0; padding: 24px; border-radius: var(--radius-md); }
    .panel { background: var(--paper); border: 1px solid var(--rule); box-shadow: var(--shadow); }
    .panel-dark { color: #FFFFFF; background: #20172E; border: 1px solid #3A2D50; }
    .eyebrow, .section-label, .header-badge, .page-footer, .cover-date, .cover-kicker {
      font-family: var(--font-mono); text-transform: uppercase; letter-spacing: .10em;
    }
    .eyebrow { color: var(--quiet); font-size: 11px; line-height: 1.35; font-weight: 700; }
    .panel-dark .eyebrow { color: #C8D0DD; }
    .page-header { min-height: 82px; display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; }
    .page-heading { min-width: 0; }
    .section-label { display: flex; align-items: center; gap: 12px; color: var(--brand-dark); font-size: 11px; font-weight: 800; }
    .section-label span { color: var(--quiet); }
    .page-header h2 { margin-top: 12px; font: 700 34px/1.08 var(--font-display); letter-spacing: -.035em; }
    .header-badge { flex: 0 0 auto; max-width: 290px; padding: 9px 13px; border-radius: 999px; background: var(--brand-soft); color: var(--brand-dark); font-size: 10px; line-height: 1.2; font-weight: 800; text-align: right; }
    .page-footer { display: flex; justify-content: space-between; gap: 24px; padding-top: 10px; border-top: 1px solid var(--rule); color: var(--quiet); font-size: 10px; line-height: 1.2; }
    .cover-page { grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 18px; }
    .cover-header { display: flex; align-items: center; justify-content: space-between; }
    .brand-lockup { display: flex; align-items: center; gap: 11px; font-size: 16px; }
    .brand-lockup i { width: 11px; height: 11px; border-radius: 3px; background: var(--brand); }
    .brand-lockup span { margin-left: 8px; color: var(--quiet); font: 600 11px/1 var(--font-mono); letter-spacing: .2em; }
    .cover-date { color: var(--quiet); font-size: 11px; }
    .cover-content { align-items: center; }
    .cover-copy { grid-column: 1 / span 7; min-width: 0; padding-right: 24px; }
    .cover-evidence { grid-column: 9 / -1; align-self: stretch; display: flex; flex-direction: column; justify-content: center; padding: 30px; }
    .cover-kicker { display: inline-flex; padding: 9px 13px; border-radius: 999px; color: var(--brand-dark); background: var(--brand-soft); font-size: 10px; font-weight: 800; }
    .cover-copy h1 { max-width: 760px; margin-top: 22px; font-family: var(--font-display); font-weight: 720; letter-spacing: -.055em; text-wrap: balance; }
    .title-standard { font-size: 58px; line-height: 1.03; }
    .title-long { font-size: 47px; line-height: 1.04; }
    .title-compact { font-size: 39px; line-height: 1.06; }
    .cover-lead { max-width: 720px; margin-top: 22px; color: var(--muted); font-size: 17px; line-height: 1.45; }
    .cover-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
    .cover-meta span, .portfolio-strip span, .source-chips span, .source-chips a { padding: 7px 10px; border: 1px solid var(--rule); border-radius: 999px; background: rgba(255,255,255,.035); color: var(--ink-2); font-size: 11px; line-height: 1.2; text-decoration: none; }
    .portfolio-strip { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
    .evidence-score { display: grid; gap: 7px; margin-top: 16px; }
    .evidence-score strong { color: #FFFFFF; font-size: 28px; line-height: 1.05; }
    .evidence-score span { color: #C8D0DD; font-size: 14px; }
    .evidence-rule { height: 1px; margin: 24px 0; background: rgba(255,255,255,.18); }
    .cover-ledger { display: grid; gap: 13px; }
    .cover-ledger div { display: flex; justify-content: space-between; gap: 18px; color: #D9DEE7; font-size: 12px; line-height: 1.35; }
    .cover-ledger dt { color: #98A2B3; }
    .cover-ledger dd { max-width: 190px; text-align: right; }
    .cover-metrics { display: grid; grid-template-columns: repeat(3, .9fr) 1.45fr; gap: 12px; }
    .cover-metrics > div { min-width: 0; min-height: 94px; display: flex; flex-direction: column; justify-content: space-between; padding: 18px 20px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .cover-metrics span { color: var(--quiet); font: 700 10px/1.2 var(--font-mono); letter-spacing: .09em; text-transform: uppercase; }
    .cover-metrics strong { margin-top: 12px; font-size: 24px; line-height: 1.1; }
    .cover-metrics .cover-decision { color: #FFFFFF; background: var(--brand-dark); border-color: var(--brand-dark); }
    .cover-metrics .cover-decision span { color: #D8E0FF; }
    .cover-metrics .cover-decision strong { font-size: 16px; line-height: 1.3; }
    .editorial-split { height: 100%; display: grid; grid-template-columns: 1.12fr .88fr; gap: 20px; }
    .summary-thesis { min-width: 0; display: flex; flex-direction: column; padding: 18px 8px 0 0; }
    .statement { margin-top: 16px; max-width: 740px; font: 650 29px/1.25 var(--font-display); letter-spacing: -.025em; }
    .decision-list { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin-top: 28px; }
    .decision-list > div { display: grid; grid-template-columns: 34px 1fr; gap: 10px; padding-top: 14px; border-top: 1px solid var(--rule); }
    .decision-list span { color: var(--brand-dark); font: 800 11px/1.4 var(--font-mono); }
    .decision-list p { color: var(--ink-2); font-size: 14px; line-height: 1.4; }
    .portfolio-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px 14px; margin-top: auto; padding-top: 16px; border-top: 1px solid var(--rule); }
    .portfolio-list span { color: var(--muted); font-size: 12px; line-height: 1.3; }
    .evidence-ledger { height: 100%; display: flex; flex-direction: column; }
    .claim-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: start; padding: 15px 0; border-bottom: 1px solid var(--rule); }
    .claim-row div { min-width: 0; }
    .claim-row strong { display: block; font-size: 13px; line-height: 1.35; }
    .claim-row span:not(.evidence-pill) { display: block; margin-top: 5px; color: var(--quiet); font: 600 10px/1.25 var(--font-mono); text-transform: uppercase; }
    .evidence-pill { display: inline-flex; padding: 6px 8px; border-radius: 999px; font-size: 10px; line-height: 1; text-transform: uppercase; white-space: nowrap; }
    .evidence-positive { color: #0D5E45; background: #E0F3EB; }
    .evidence-warning { color: #764600; background: #FAEDCF; }
    .evidence-neutral { color: #475467; background: #EEF1F5; }
    .empty-state { display: flex; flex-direction: column; justify-content: center; gap: 8px; min-height: 140px; color: var(--muted); }
    .empty-state strong { color: var(--ink); }
    .problem-arc { height: 430px; display: grid; grid-template-columns: 1fr 38px 1fr 38px 1fr; align-items: stretch; }
    .arc-block { min-width: 0; display: flex; flex-direction: column; padding: 26px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .arc-solution { color: #FFFFFF; background: #20172E; border-color: #3A2D50; }
    .arc-solution .eyebrow { color: #C8D0DD; }
    .arc-outcome { border-top: 4px solid var(--brand); }
    .arc-index { margin-left: auto; color: var(--quiet); font: 700 10px/1 var(--font-mono); }
    .arc-block > p { margin-top: 20px; font: 600 16px/1.42 var(--font-display); letter-spacing: -.012em; }
    .arc-block ul { display: grid; gap: 13px; margin-top: 24px; list-style: none; }
    .arc-block li { position: relative; padding-left: 18px; color: var(--ink-2); font-size: 14px; line-height: 1.4; }
    .arc-block li::before { content: ""; position: absolute; top: .55em; left: 0; width: 7px; height: 7px; border-radius: 50%; background: var(--brand); }
    .arc-arrow { display: grid; place-items: center; color: var(--brand); font-size: 24px; }
    .question-rail { display: grid; grid-template-columns: 230px 1fr; gap: 18px; margin-top: 18px; padding-top: 15px; border-top: 1px solid var(--rule); }
    .question-rail > div { display: grid; gap: 5px; }
    .question-rail span { color: var(--quiet); font: 700 10px/1.2 var(--font-mono); text-transform: uppercase; }
    .question-rail strong, .question-rail p { font-size: 13px; line-height: 1.35; }
    .question-copy { grid-template-columns: 145px 1fr !important; align-items: start; }
    .market-layout { height: 100%; display: grid; grid-template-columns: 1.2fr .8fr; gap: 20px; }
    .market-bars { display: flex; flex-direction: column; justify-content: center; gap: 24px; padding: 26px 4px; }
    .market-row { display: grid; grid-template-columns: 150px minmax(0,1fr) 150px; gap: 18px; align-items: center; }
    .market-row > div:first-child { display: grid; gap: 5px; }
    .market-row span { color: var(--brand-dark); font: 800 13px/1.1 var(--font-mono); }
    .market-row small { color: var(--muted); font-size: 12px; line-height: 1.25; }
    .market-row strong { text-align: right; font-size: 22px; }
    .market-track { height: 24px; padding: 4px; border-radius: 999px; background: #292433; }
    .market-track i { display: block; height: 100%; border-radius: inherit; background: var(--brand); }
    .market-track-empty { display: flex; align-items: center; justify-content: center; padding: 0 12px; border: 1px dashed var(--rule); background: transparent; }
    .market-track-empty em { color: var(--quiet); font: 600 9px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
    .market-assumptions { height: 100%; }
    .formula { margin-top: 20px; font: 650 19px/1.35 var(--font-display); }
    .market-assumptions ul { display: grid; gap: 10px; margin-top: 20px; padding-left: 18px; }
    .market-assumptions li { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .market-signals { display: grid; gap: 8px; margin-top: 18px; padding: 14px; border-radius: var(--radius-sm); background: var(--brand-soft); }
    .market-signals > div:not(.eyebrow) { display: grid; gap: 4px; }
    .market-signals strong { color: var(--ink); font-size: 11px; line-height: 1.35; }
    .market-signals span { color: var(--brand-dark); font: 700 10px/1.25 var(--font-mono); }
    .source-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 22px; }
    .scope-map-layout { height: 100%; display: grid; grid-template-columns: .78fr 1.72fr; gap: 20px; }
    .scope-root { display: flex; flex-direction: column; justify-content: center; }
    .scope-root > strong { margin-top: 18px; font: 700 32px/1.08 var(--font-display); letter-spacing: -.035em; }
    .scope-root > span { margin-top: 10px; color: #C8D0DD; font-size: 14px; }
    .scope-root-metric { display: flex; align-items: baseline; gap: 12px; margin-top: 34px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,.18); }
    .scope-root-metric b { font-size: 34px; }
    .scope-root-metric small { max-width: 150px; color: #C8D0DD; font-size: 11px; line-height: 1.3; }
    .module-grid { display: grid; gap: 12px; align-content: stretch; }
    .modules-1, .modules-2 { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .modules-3, .modules-4 { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .modules-5, .modules-6 { grid-template-columns: repeat(3, minmax(0,1fr)); }
    .module-card { min-width: 0; padding: 18px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .module-head { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--rule); }
    .module-head strong { font-size: 15px; line-height: 1.2; }
    .module-head span { color: var(--brand-dark); font: 800 12px/1 var(--font-mono); }
    .module-card ul { display: grid; gap: 8px; margin-top: 10px; list-style: none; }
    .module-card li { display: grid; gap: 3px; }
    .module-card li b { font-size: 12px; line-height: 1.25; }
    .module-card li small { color: var(--muted); font-size: 10px; line-height: 1.25; }
    .module-more { margin-top: 9px; color: var(--brand-dark); font-size: 10px; }
    .journey-legend { display: flex; justify-content: flex-end; gap: 16px; margin-top: -8px; }
    .journey-legend span { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 10px; }
    .journey-legend i { width: 8px; height: 8px; border-radius: 50%; }
    .journey-legend .requested { background: var(--brand); }
    .journey-legend .recommended { border: 1px dashed var(--warning); }
    .journey-grid { display: grid; grid-template-columns: repeat(var(--steps), minmax(0,1fr)); gap: 16px; align-items: stretch; margin-top: 18px; }
    .journey-step { position: relative; min-width: 0; min-height: 285px; padding: 19px; border: 1px solid var(--rule); border-top: 4px solid var(--brand); border-radius: var(--radius-md); background: var(--paper); contain: layout; }
    .journey-step:not(:last-child)::after { content: "→"; position: absolute; top: 50%; right: -15px; z-index: 2; width: 14px; color: var(--brand-dark); font-size: 18px; transform: translateY(-50%); }
    .journey-recommended { border-top-style: dashed; border-top-color: var(--warning); }
    .journey-actor { min-height: 32px; color: var(--brand-dark); font: 750 10px/1.3 var(--font-mono); text-transform: uppercase; }
    .journey-number { display: inline-flex; margin-top: 12px; color: var(--quiet); font: 700 10px/1 var(--font-mono); }
    .journey-step h3 { margin-top: 18px; font-size: 17px; line-height: 1.18; }
    .journey-step p { margin-top: 12px; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .exception-rail, .architecture-note { display: grid; grid-template-columns: 210px 1fr; gap: 18px; margin-top: 18px; padding: 15px 18px; border: 1px solid var(--rule); border-radius: var(--radius-sm); background: var(--brand-soft); }
    .exception-rail strong, .architecture-note strong { color: var(--brand-dark); font-size: 12px; }
    .exception-rail span, .architecture-note span { color: var(--ink-2); font-size: 12px; line-height: 1.35; }
    .architecture-stack { display: grid; gap: 11px; }
    .architecture-layer { position: relative; display: grid; grid-template-columns: 210px 1fr; gap: 16px; align-items: stretch; contain: layout; }
    .architecture-layer:not(:last-child)::after { content: "↓"; position: absolute; left: 96px; bottom: -16px; z-index: 2; color: var(--brand-dark); font-size: 16px; }
    .layer-label { display: grid; grid-template-columns: 28px 1fr; gap: 5px 10px; align-content: center; padding: 13px 16px; border-radius: var(--radius-sm); color: #FFFFFF; background: #20172E; }
    .layer-label > span { grid-row: 1 / span 2; color: #98A2B3; font: 700 10px/1.2 var(--font-mono); }
    .layer-label strong { font-size: 14px; }
    .layer-label small { color: #C8D0DD; font-size: 10px; }
    .layer-nodes { display: grid; grid-template-columns: repeat(var(--nodes), minmax(0,1fr)); gap: 9px; }
    .layer-nodes div { min-width: 0; display: grid; place-items: center; padding: 12px; border: 1px solid var(--rule); border-radius: var(--radius-sm); background: var(--paper); color: var(--ink-2); font-size: 12px; line-height: 1.3; text-align: center; }
    .architecture-note { margin-top: 12px; }
    .risk-table { border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .risk-head, .risk-row { display: grid; grid-template-columns: .82fr 1.15fr .42fr 1.15fr; gap: 16px; align-items: center; }
    .risk-head { padding: 11px 16px; color: var(--quiet); font: 700 9px/1.2 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
    .risk-row { min-height: 82px; padding: 13px 16px; border-top: 1px solid var(--rule); }
    .risk-row > div { display: grid; gap: 6px; }
    .risk-row strong { font-size: 13px; line-height: 1.25; }
    .risk-row p { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .risk-row > b { font-size: 12px; }
    .risk-type { width: max-content; padding: 4px 7px; border-radius: 999px; font-size: 10px; text-transform: uppercase; }
    .risk-positive { color: #0D5E45; background: #E0F3EB; }
    .risk-negative { color: #8A2E2E; background: #FBE8E8; }
    .price-summary { display: flex; align-items: baseline; gap: 16px; margin-top: -6px; }
    .price-summary span, .price-summary small { color: var(--muted); font-size: 12px; }
    .price-summary strong { font-size: 28px; }
    .function-price-list { margin-top: 14px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .function-price-row { min-height: 58px; display: grid; grid-template-columns: 1.18fr .88fr 130px; gap: 18px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--rule); }
    .function-price-row:first-child { border-top: 0; }
    .function-price-row > div { min-width: 0; display: grid; gap: 5px; }
    .function-price-row strong { font-size: 13px; }
    .function-price-row span { color: var(--muted); font-size: 10px; line-height: 1.25; }
    .function-price-row i { display: block; width: var(--bar); height: 5px; border-radius: 999px; background: var(--brand); }
    .function-price-row > b { text-align: right; font-size: 13px; }
    .reconcile-note, .payment-total { display: flex; justify-content: space-between; gap: 24px; align-items: center; margin-top: 12px; padding: 12px 16px; border-radius: var(--radius-sm); }
    .reconcile-note strong, .payment-total strong { font-size: 12px; }
    .reconcile-note span, .payment-total p { font-size: 11px; line-height: 1.3; }
    .note-positive { color: #0D5E45; background: #E0F3EB; }
    .note-warning { color: #764600; background: #FAEDCF; }
    .design-layout { height: 100%; display: grid; grid-template-columns: .9fr 1.1fr; gap: 20px; }
    .design-system { display: flex; flex-direction: column; justify-content: center; padding: 30px; }
    .design-system h3 { margin-top: 15px; font: 700 30px/1.1 var(--font-display); letter-spacing: -.03em; text-transform: capitalize; }
    .design-system > p { margin-top: 14px; color: #D0D5DD; font-size: 13px; line-height: 1.45; }
    .palette-row { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 8px; margin-top: 24px; }
    .palette-row div { display: grid; gap: 6px; }
    .palette-row i { height: 46px; border: 1px solid rgba(255,255,255,.22); border-radius: 8px; }
    .palette-row span { color: #C8D0DD; font: 600 10px/1.2 var(--font-mono); }
    .type-specimen { display: flex; align-items: center; gap: 16px; margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.18); }
    .type-specimen > span { font: 700 38px/1.08 var(--font-display); }
    .type-specimen div { display: grid; gap: 4px; }
    .type-specimen strong { font-size: 12px; }
    .type-specimen small { color: #C8D0DD; font-size: 10px; }
    .design-stages { display: grid; grid-template-rows: repeat(4,minmax(0,1fr)); gap: 10px; }
    .design-stages article { display: grid; grid-template-columns: 44px 1fr; gap: 15px; align-items: center; padding: 16px 18px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .design-stages article > span { color: var(--brand-dark); font: 800 11px/1 var(--font-mono); }
    .design-stages article div { display: grid; gap: 5px; }
    .design-stages strong { font-size: 14px; }
    .design-stages p { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .team-table { border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .team-head, .team-row { display: grid; grid-template-columns: 280px 1fr 120px; gap: 18px; align-items: center; }
    .team-head { padding: 10px 15px; color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .team-head > div, .team-timeline { display: grid; grid-template-columns: repeat(var(--months), minmax(0,1fr)); gap: 5px; }
    .team-head b { text-align: center; font-size: 10px; }
    .team-row { min-height: 53px; padding: 8px 15px; border-top: 1px solid var(--rule); }
    .team-row > div:first-child { display: grid; gap: 3px; }
    .team-row strong { font-size: 12px; }
    .team-row span { color: var(--muted); font-size: 10px; }
    .team-timeline i { height: 18px; display: grid; place-items: center; border-radius: 4px; background: #292433; }
    .team-timeline i span { color: var(--brand-on); font: 800 9px/1 var(--font-mono); }
    .team-timeline .active { background: var(--brand); }
    .team-timeline .partial { background: linear-gradient(90deg,var(--brand) 50%,#292433 50%); }
    .team-row > b { text-align: right; font-size: 12px; }
    .team-total { display: flex; align-items: baseline; gap: 14px; margin-top: 12px; }
    .team-total span, .team-total small { color: var(--muted); font-size: 11px; }
    .team-total strong { font-size: 22px; }
    .commercial-layout { height: 100%; display: grid; grid-template-columns: .92fr 1.08fr; grid-template-rows: 1fr auto; gap: 16px; }
    .investment-panel { grid-row: 1 / span 2; display: flex; flex-direction: column; justify-content: center; padding: 30px; }
    .investment-panel > strong { margin-top: 18px; color: #FFFFFF; font-size: 52px; line-height: 1.06; letter-spacing: -.04em; }
    .investment-panel > p { margin-top: 18px; color: #D0D5DD; font-size: 14px; line-height: 1.45; }
    .terms-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 9px; margin-top: 26px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.18); }
    .terms-grid span { display: grid; gap: 5px; color: #D0D5DD; font-size: 10px; line-height: 1.3; }
    .terms-grid b { color: #FFFFFF; font-size: 10px; text-transform: uppercase; }
    .external-card, .exclusion-card { padding: 18px 20px; }
    .external-note { margin-top: 7px; color: var(--muted); font-size: 10px; line-height: 1.3; }
    .external-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--rule); }
    .external-row:last-child { border-bottom: 0; }
    .external-row div { display: grid; gap: 2px; }
    .external-row strong, .external-row > b { font-size: 11px; }
    .external-row span { color: var(--muted); font-size: 10px; }
    .exclusion-card ul { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px 18px; margin-top: 12px; padding-left: 16px; }
    .exclusion-card li { color: var(--muted); font-size: 10px; line-height: 1.3; }
    .payment-track { display: grid; grid-template-columns: repeat(var(--payments),minmax(0,1fr)); gap: 14px; }
    .payment-card { position: relative; min-height: 335px; display: flex; flex-direction: column; padding: 22px; border: 1px solid var(--rule); border-top: 4px solid var(--brand); border-radius: var(--radius-md); background: var(--paper); contain: layout; }
    .payment-card:not(:last-child)::after { content: "→"; position: absolute; top: 50%; right: -14px; z-index: 2; color: var(--brand-dark); font-size: 17px; }
    .payment-top { display: flex; justify-content: space-between; color: var(--quiet); font: 700 10px/1 var(--font-mono); }
    .payment-top b { color: var(--brand-dark); font-size: 16px; }
    .payment-card h3 { margin-top: 34px; font-size: 17px; line-height: 1.2; }
    .payment-card > strong { margin-top: 12px; font-size: 28px; }
    .payment-card p { margin-top: 18px; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .payment-card small { margin-top: auto; padding-top: 14px; color: var(--quiet); font-size: 10px; }
    .payment-total { margin-top: 16px; }
    .payment-total > div { display: grid; gap: 4px; min-width: 180px; }
    .payment-total span { font-size: 10px; text-transform: uppercase; }
    .roadmap-grid { display: grid; grid-template-columns: repeat(var(--road-cols),minmax(0,1fr)); gap: 12px; align-content: start; }
    .roadmap-grid.roadmap-single { height: 100%; align-content: center; }
    .roadmap-grid.roadmap-single .roadmap-card { min-height: 320px; }
    .roadmap-card { position: relative; min-height: 230px; padding: 20px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .roadmap-card::before { content: ""; position: absolute; top: 30px; left: 0; right: 0; height: 2px; background: var(--rule); }
    .roadmap-marker { position: relative; z-index: 1; display: inline-grid; place-items: center; width: 28px; height: 28px; margin-bottom: 18px; border-radius: 50%; color: #FFFFFF; background: var(--brand); font: 800 10px/1 var(--font-mono); }
    .roadmap-assumption .roadmap-marker { background: var(--warning); }
    .roadmap-card h3 { margin-top: 11px; font-size: 15px; line-height: 1.25; }
    .roadmap-card p { margin-top: 11px; color: var(--muted); font-size: 11px; line-height: 1.38; }
    .roadmap-card small { display: block; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--rule); color: var(--quiet); font-size: 10px; line-height: 1.3; }
    .sources-layout { height: 100%; display: grid; grid-template-columns: 1.2fr .8fr; gap: 20px; }
    .source-register { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px 18px; align-content: start; padding: 20px; }
    .source-group { min-width: 0; }
    .source-group-title { display: flex; justify-content: space-between; gap: 10px; padding-bottom: 7px; border-bottom: 2px solid var(--ink); text-transform: capitalize; }
    .source-group-title strong { font-size: 11px; }
    .source-group-title span { color: var(--brand-dark); font: 800 10px/1 var(--font-mono); }
    .source-entry { min-width: 0; display: grid; grid-template-columns: 68px minmax(0,1fr); gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--rule); }
    .source-entry > span { color: var(--quiet); font: 600 10px/1.25 var(--font-mono); overflow-wrap: anywhere; }
    .source-entry div { min-width: 0; display: grid; gap: 3px; }
    .source-entry strong, .source-entry a { color: var(--ink); font-size: 10px; line-height: 1.25; font-weight: 700; text-decoration: none; overflow-wrap: anywhere; }
    .source-entry small { color: var(--muted); font-size: 10px; line-height: 1.25; overflow-wrap: anywhere; }
    .source-more { grid-column: 1 / -1; color: var(--muted); font-size: 10px; }
    .approval-card { display: flex; flex-direction: column; justify-content: center; padding: 28px; }
    .approval-card h3 { margin-top: 16px; font: 700 26px/1.15 var(--font-display); letter-spacing: -.025em; }
    .approval-card ol { display: grid; gap: 11px; margin-top: 22px; padding-left: 18px; }
    .approval-card li { color: #D0D5DD; font-size: 12px; line-height: 1.4; }
    .signature-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; margin-top: 26px; }
    .signature-grid span { padding-top: 34px; border-bottom: 1px solid rgba(255,255,255,.38); color: #C8D0DD; font-size: 10px; }
    .approval-cta { margin-top: 22px; padding: 13px; border-radius: var(--radius-sm); color: var(--brand-dark-on); background: var(--brand-dark); font-size: 12px; font-weight: 800; text-align: center; }
    .page-intro { max-width: 980px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .editorial-conclusion { display: grid; grid-template-columns: 180px 1fr; gap: 20px; align-items: center; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--rule); }
    .editorial-conclusion span { color: var(--brand-dark); font: 800 10px/1.2 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
    .editorial-conclusion strong { font-size: 15px; line-height: 1.35; }

    .cover-content { min-height: 0; }
    .cover-copy { grid-column: 1 / span 7; }
    .cover-truth { grid-column: 9 / -1; min-height: 440px; display: grid; grid-template-columns: 34px 1fr; gap: 20px; align-items: center; }
    .truth-side-label { writing-mode: vertical-rl; transform: rotate(180deg); color: var(--ink); font: 800 16px/1 var(--font-display); letter-spacing: -.01em; text-transform: uppercase; }
    .truth-rail { position: relative; display: grid; gap: 54px; }
    .truth-rail::before { content: ""; position: absolute; top: 18px; bottom: 18px; left: 102px; width: 1px; background: var(--rule); }
    .truth-row { position: relative; display: grid; grid-template-columns: 82px 40px 1fr; gap: 0 14px; align-items: center; min-height: 64px; }
    .truth-row > span { color: var(--quiet); font: 800 10px/1.2 var(--font-mono); letter-spacing: .08em; }
    .truth-row i { position: relative; z-index: 1; width: 12px; height: 12px; justify-self: center; border: 2px solid var(--brand-dark); border-radius: 50%; background: var(--canvas); }
    .truth-row strong { color: var(--ink-2); font-size: 13px; line-height: 1.35; }
    .truth-warning i { border-color: var(--warning); }
    .truth-critical i { border-color: var(--critical); }
    .cover-baseline { display: flex; justify-content: space-between; gap: 24px; padding: 12px 0 2px; border-top: 1px solid var(--rule); }
    .cover-baseline span { color: var(--quiet); font: 700 10px/1.2 var(--font-mono); text-transform: uppercase; }
    .cover-baseline strong { color: var(--ink-2); font-size: 11px; }

    .trust-thread { position: relative; min-height: 410px; display: grid; grid-template-columns: repeat(var(--trust-count), minmax(0,1fr)); gap: 28px; align-items: start; margin-top: 34px; padding-top: 56px; }
    .trust-thread::before { content: ""; position: absolute; top: 66px; left: 7%; right: 7%; height: 1px; background: var(--rule); }
    .trust-moment { position: relative; min-width: 0; }
    .trust-node { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; margin-bottom: 44px; }
    .trust-node i { width: 20px; height: 20px; border: 4px solid var(--canvas); border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
    .trust-node span { color: var(--quiet); font: 700 10px/1 var(--font-mono); }
    .trust-warning .trust-node i { background: var(--warning); box-shadow: 0 0 0 1px var(--warning); }
    .trust-critical .trust-node i { background: var(--critical); box-shadow: 0 0 0 1px var(--critical); }
    .trust-moment h3 { margin-top: 14px; font-size: 17px; line-height: 1.2; }
    .trust-moment p { margin-top: 10px; color: var(--muted); font-size: 12px; line-height: 1.45; }

    .chapter-page .page-content { display: flex; flex-direction: column; justify-content: center; }
    .chapter-layout { display: grid; grid-template-columns: 1.2fr .8fr; gap: 72px; align-items: center; }
    .chapter-thesis { min-width: 0; }
    .chapter-number { color: var(--brand-dark); font: 800 52px/1 var(--font-display); letter-spacing: -.05em; }
    .chapter-thesis p { max-width: 690px; margin-top: 30px; color: var(--muted); font-size: 17px; line-height: 1.5; }
    .chapter-thesis > strong { display: block; margin-top: 46px; font-size: 21px; line-height: 1.3; }
    .chapter-signals { display: grid; gap: 0; border-top: 1px solid var(--rule); }
    .chapter-signals article { display: grid; grid-template-columns: 120px 1fr; gap: 8px 22px; padding: 25px 0; border-bottom: 1px solid var(--rule); }
    .chapter-signals strong { grid-row: 1 / span 2; color: var(--brand-dark); font-size: 26px; line-height: 1; }
    .chapter-signals p { color: var(--ink-2); font-size: 12px; line-height: 1.4; }
    .chapter-signals span { color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }

    .handoff-flow { min-height: 390px; display: grid; grid-template-columns: repeat(var(--handoff-count), minmax(0,1fr)); gap: 24px; align-items: center; margin-top: 24px; }
    .handoff-segment { position: relative; min-width: 0; }
    .handoff-segment article { display: flex; flex-direction: column; min-height: 245px; padding: 22px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .handoff-segment article > span { color: var(--brand-dark); font: 800 10px/1.2 var(--font-mono); text-transform: uppercase; }
    .handoff-segment article > i { width: 16px; height: 16px; margin-top: 35px; border: 2px solid var(--brand-dark); border-radius: 50%; }
    .handoff-segment article > strong { margin-top: 24px; font-size: 16px; line-height: 1.25; }
    .handoff-segment article > small { margin-top: 10px; color: var(--muted); font-size: 11px; line-height: 1.4; }
    .handoff-break { position: absolute; z-index: 3; top: 91px; right: -45px; width: 66px; display: grid; justify-items: center; gap: 8px; }
    .handoff-break b { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; color: var(--critical); background: var(--canvas); font-size: 17px; }
    .handoff-break span { padding: 5px 7px; border-radius: 4px; color: var(--critical); background: #2B171B; font: 700 10px/1.2 var(--font-mono); text-align: center; }

    .market-research-layout { height: 100%; display: grid; grid-template-columns: .8fr 1.2fr; gap: 30px; }
    .market-evidence-hero { display: flex; flex-direction: column; justify-content: center; padding: 34px; border-left: 3px solid var(--brand); background: linear-gradient(135deg, var(--brand-soft), transparent 80%); }
    .market-evidence-hero > strong { margin-top: 18px; color: var(--brand-dark); font-size: 44px; line-height: 1.02; letter-spacing: -.04em; }
    .market-evidence-hero > p { margin-top: 24px; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .market-source-count { display: flex; align-items: baseline; gap: 14px; margin-top: 44px; padding-top: 20px; border-top: 1px solid var(--rule); }
    .market-source-count b { font-size: 32px; }
    .market-source-count span { max-width: 150px; color: var(--quiet); font-size: 11px; line-height: 1.3; }
    .market-research-signals { display: flex; flex-direction: column; justify-content: center; }
    .market-research-signals > article { display: grid; grid-template-columns: 150px 1fr; gap: 22px; align-items: center; min-height: 90px; padding: 17px 0; border-bottom: 1px solid var(--rule); }
    .market-research-signals > article > div { display: grid; gap: 6px; }
    .market-research-signals > article span { color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .market-research-signals > article strong { color: var(--brand-dark); font-size: 21px; }
    .market-research-signals > article p { color: var(--ink-2); font-size: 13px; line-height: 1.4; }

    .analog-table { margin-top: 22px; border-top: 1px solid var(--rule); }
    .analog-head, .analog-row { display: grid; grid-template-columns: .72fr 1.7fr .78fr .55fr; gap: 20px; align-items: center; }
    .analog-head { padding: 10px 16px; color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .analog-row { min-height: 76px; padding: 13px 16px; border-top: 1px solid var(--rule); }
    .analog-row strong { font-size: 13px; }
    .analog-row p { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .analog-row span { color: var(--ink-2); font-size: 11px; }
    .analog-row b { color: var(--brand-dark); font: 800 9px/1.2 var(--font-mono); }
    .analog-proposed { border: 1px solid var(--brand-dark); background: var(--brand-soft); }

    .boundary-flow { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-top: 28px; }
    .boundary-lane { position: relative; min-height: 365px; padding: 22px; border: 1px solid var(--rule); border-top: 3px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .boundary-lane:not(:last-child)::after { content: "→"; position: absolute; z-index: 2; top: 50%; right: -14px; color: var(--quiet); font-size: 18px; }
    .boundary-brand { border-top-color: var(--brand); }
    .boundary-warning { border-top-color: var(--warning); }
    .boundary-critical { border-top-color: var(--critical); }
    .boundary-top { display: flex; justify-content: space-between; color: var(--quiet); font: 800 9px/1 var(--font-mono); text-transform: uppercase; }
    .boundary-top b { color: var(--ink-2); }
    .boundary-lane h3 { margin-top: 30px; font-size: 18px; line-height: 1.2; }
    .boundary-lane ul { display: grid; gap: 13px; margin-top: 28px; list-style: none; }
    .boundary-lane li { padding-top: 11px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 12px; line-height: 1.35; }

    .product-chapter-layout { height: 100%; display: grid; align-content: center; }
    .product-chapter-layout > p { max-width: 850px; margin-top: 24px; color: var(--muted); font-size: 17px; line-height: 1.45; }
    .product-spine { position: relative; display: grid; grid-template-columns: repeat(var(--product-count),minmax(0,1fr)); gap: 24px; margin-top: 64px; padding-top: 24px; }
    .product-spine::before { content: ""; position: absolute; top: 31px; left: 5%; right: 5%; height: 1px; background: var(--rule); }
    .product-spine article { position: relative; z-index: 1; display: grid; gap: 10px; }
    .product-spine i { width: 16px; height: 16px; border: 3px solid var(--canvas); border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
    .product-spine article:nth-child(3) i { background: var(--warning); box-shadow: 0 0 0 1px var(--warning); }
    .product-spine article:nth-child(4) i { background: var(--critical); box-shadow: 0 0 0 1px var(--critical); }
    .product-spine span { margin-top: 16px; color: var(--brand-dark); font: 800 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .product-spine strong { font-size: 15px; line-height: 1.25; }
    .product-spine small { color: var(--muted); font-size: 11px; line-height: 1.35; }

    .domain-map { height: 100%; display: grid; grid-template-columns: .62fr 1.38fr; gap: 24px; }
    .domain-index { display: flex; flex-direction: column; justify-content: center; padding: 28px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--brand-soft); }
    .domain-index span { color: var(--brand-dark); font: 800 10px/1.2 var(--font-mono); text-transform: uppercase; }
    .domain-index strong { margin-top: 22px; font-size: 30px; line-height: 1.08; }
    .domain-index p { margin-top: 18px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .domain-layers { display: grid; grid-template-rows: repeat(3,1fr) auto; gap: 12px; }
    .domain-layer { display: grid; grid-template-columns: 190px 1fr; gap: 18px; align-items: stretch; padding: 14px; border: 1px solid var(--rule); border-left: 3px solid var(--brand); border-radius: var(--radius-md); background: var(--paper); }
    .domain-warning { border-left-color: var(--warning); }
    .domain-layer > div { display: grid; grid-template-columns: 28px 1fr; gap: 4px 8px; align-content: center; }
    .domain-layer > div span { grid-row: 1 / span 2; color: var(--quiet); font: 700 9px/1.2 var(--font-mono); }
    .domain-layer > div strong { font-size: 13px; }
    .domain-layer > div small { color: var(--muted); font-size: 10px; }
    .domain-layer > section { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 8px; }
    .domain-layer > section b { display: grid; place-items: center; min-width: 0; padding: 9px; border: 1px solid var(--rule); border-radius: 6px; color: var(--ink-2); font-size: 10px; line-height: 1.25; text-align: center; }
    .domain-truth { padding: 9px 14px; border-radius: 6px; color: var(--brand-dark); background: var(--brand-soft); font: 800 10px/1.2 var(--font-mono); text-align: center; text-transform: uppercase; }

    .bpmn-shell { border: 1px solid var(--rule); border-radius: var(--radius-md); overflow: hidden; background: var(--paper); }
    .bpmn-head, .bpmn-lane { display: grid; grid-template-columns: 150px 1fr; }
    .bpmn-head { min-height: 34px; color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .bpmn-head > span, .bpmn-lane > strong { display: flex; align-items: center; padding: 9px 12px; border-right: 1px solid var(--rule); }
    .bpmn-head > div, .bpmn-track { display: grid; grid-template-columns: repeat(var(--bpmn-steps),minmax(0,1fr)); }
    .bpmn-head b { display: grid; place-items: center; border-left: 1px solid var(--rule); }
    .bpmn-lane { min-height: 88px; border-top: 1px solid var(--rule); }
    .bpmn-lane > strong { color: var(--ink-2); font-size: 11px; }
    .bpmn-track { position: relative; align-items: center; }
    .bpmn-track::before { content: ""; position: absolute; left: 5%; right: 5%; top: 50%; height: 1px; background: var(--rule); }
    .bpmn-track > i { min-height: 88px; border-left: 1px solid var(--rule); }
    .bpmn-track article { position: relative; z-index: 1; min-width: 0; margin: 7px; padding: 9px; border: 1px solid var(--brand-dark); border-radius: 7px; background: var(--canvas); }
    .bpmn-track article span { display: block; color: var(--brand-dark); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .bpmn-track article b { display: block; margin-top: 4px; font-size: 10px; line-height: 1.2; }
    .bpmn-track article small { display: block; margin-top: 3px; color: var(--muted); font-size: 10px; line-height: 1.2; }
    .bpmn-track .bpmn-decision { transform: rotate(1deg); border-color: var(--warning); }
    .bpmn-outcomes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .bpmn-outcomes div { padding: 12px 14px; border: 1px solid var(--rule); border-left: 3px solid var(--positive); border-radius: 7px; }
    .bpmn-outcomes div:last-child { border-left-color: var(--critical); }
    .bpmn-outcomes span { color: var(--quiet); font: 800 10px/1.2 var(--font-mono); }
    .bpmn-outcomes strong { display: block; margin-top: 6px; color: var(--ink-2); font-size: 10px; line-height: 1.3; }

    .swot-axis-labels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: -4px 0 8px; color: var(--quiet); font: 800 9px/1.2 var(--font-mono); text-align: center; text-transform: uppercase; }
    .swot-matrix { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 12px; height: 100%; }
    .swot-quadrant { min-height: 0; padding: 24px; border: 1px solid var(--rule); border-radius: var(--radius-md); background: var(--paper); }
    .swot-quadrant > div { display: flex; justify-content: space-between; gap: 20px; align-items: baseline; padding-bottom: 14px; border-bottom: 1px solid var(--rule); }
    .swot-quadrant > div span { color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .swot-quadrant > div strong { font-size: 17px; }
    .swot-quadrant ul { display: grid; gap: 10px; margin-top: 16px; padding-left: 17px; }
    .swot-quadrant li { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .swot-quadrant > p { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--rule); color: var(--ink-2); font-size: 10px; line-height: 1.35; }
    .swot-quadrant > p span { display: block; margin-bottom: 5px; color: var(--quiet); font: 700 10px/1.2 var(--font-mono); text-transform: uppercase; }
    .swot-strength { border-left: 3px solid var(--positive); }
    .swot-weakness { border-left: 3px solid var(--warning); }
    .swot-opportunity { border-left: 3px solid var(--brand); }
    .swot-threat { border-left: 3px solid var(--critical); }

    .delivery-chapter-layout { display: grid; grid-template-columns: 1fr auto; gap: 80px; align-items: center; }
    .delivery-chapter-layout section p { max-width: 760px; margin-top: 24px; color: var(--muted); font-size: 17px; line-height: 1.45; }
    .delivery-chapter-layout aside { display: grid; grid-template-columns: auto 80px; gap: 10px 18px; align-items: baseline; min-width: 220px; padding-left: 34px; border-left: 1px solid var(--rule); }
    .delivery-chapter-layout aside strong { color: var(--brand-dark); font-size: 38px; }
    .delivery-chapter-layout aside span { color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .delivery-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 18px; margin-top: 56px; }
    .delivery-metrics article { padding-top: 14px; border-top: 1px solid var(--rule); }
    .delivery-metrics i { display: block; width: 54px; height: 3px; background: var(--brand); }
    .delivery-metrics article:nth-child(2) i { background: var(--warning); }
    .delivery-metrics article:nth-child(3) i { background: var(--positive); }
    .delivery-metrics article:nth-child(4) i { background: var(--critical); }
    .delivery-metrics span { display: block; margin-top: 14px; color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .delivery-metrics strong { display: block; margin-top: 12px; font-size: 21px; }
    .delivery-metrics p { margin-top: 9px; color: var(--muted); font-size: 10px; line-height: 1.35; }

    .team-month-total { display: grid; grid-template-columns: 280px 1fr 120px; gap: 18px; align-items: center; margin-top: 8px; padding: 8px 15px; border: 1px solid var(--rule); border-radius: var(--radius-sm); }
    .team-month-total > strong, .team-month-total > span { font-size: 10px; }
    .team-month-total > span { color: var(--quiet); text-align: right; }
    .team-month-total > div { display: grid; grid-template-columns: repeat(var(--months),minmax(0,1fr)); gap: 5px; }
    .team-month-total b { padding: 5px; border-radius: 4px; background: #292433; color: var(--muted); font: 800 9px/1 var(--font-mono); text-align: center; }
    .team-month-total .peak { color: var(--brand-dark-on); background: var(--brand-dark); }

    .gantt-chart { margin-top: 20px; border: 1px solid var(--rule); border-radius: var(--radius-md); overflow: hidden; background: var(--paper); }
    .gantt-head, .gantt-row { display: grid; grid-template-columns: 260px 1fr; }
    .gantt-head { min-height: 34px; color: var(--quiet); font: 700 10px/1.2 var(--font-mono); text-transform: uppercase; }
    .gantt-head > span, .gantt-row > div:first-child { padding: 10px 12px; border-right: 1px solid var(--rule); }
    .gantt-head > div, .gantt-track { display: grid; grid-template-columns: repeat(var(--road-units),minmax(0,1fr)); }
    .gantt-head b { display: grid; place-items: center; border-left: 1px solid var(--rule); }
    .gantt-row { min-height: 70px; border-top: 1px solid var(--rule); }
    .gantt-row > div:first-child { display: grid; align-content: center; gap: 4px; }
    .gantt-row > div:first-child span { color: var(--quiet); font: 700 10px/1.2 var(--font-mono); text-transform: uppercase; }
    .gantt-row > div:first-child strong { font-size: 11px; }
    .gantt-row > div:first-child small { color: var(--muted); font-size: 10px; line-height: 1.25; }
    .gantt-track { position: relative; align-items: center; background-image: linear-gradient(90deg,var(--rule) 1px,transparent 1px); background-size: calc(100% / var(--road-units)) 100%; }
    .gantt-track i { grid-column: var(--start) / span var(--span); height: 18px; border-radius: 4px; background: var(--brand); }
    .gantt-track .gantt-tone-2 { background: var(--warning); }
    .gantt-track .gantt-tone-3 { background: var(--critical); }
    .gantt-track .gantt-tone-4 { background: var(--positive); }
    .gantt-track > b { grid-column: var(--gate); grid-row: 1; justify-self: end; width: 8px; height: 28px; border-right: 2px solid var(--ink); }
    .gantt-gates { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 14px; margin-top: 14px; }
    .gantt-gates span { padding-top: 10px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 10px; line-height: 1.3; }

    .payment-table { margin-top: 22px; border-top: 1px solid var(--rule); }
    .payment-head, .payment-row { display: grid; grid-template-columns: .9fr 1.45fr .62fr .72fr; gap: 18px; align-items: center; }
    .payment-head { padding: 10px 14px; color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .payment-row { min-height: 92px; padding: 14px; border-top: 1px solid var(--rule); }
    .payment-row > div { display: grid; grid-template-columns: 4px 30px 1fr; gap: 10px; align-items: center; }
    .payment-row > div i { width: 4px; height: 42px; background: var(--brand); }
    .payment-row > div .payment-tone-2 { background: var(--warning); }
    .payment-row > div .payment-tone-3 { background: var(--critical); }
    .payment-row > div .payment-tone-4 { background: var(--positive); }
    .payment-row > div span { color: var(--quiet); font: 700 9px/1 var(--font-mono); }
    .payment-row > div strong { font-size: 13px; line-height: 1.25; }
    .payment-row > p { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .payment-row > b { display: grid; gap: 6px; font-size: 13px; }
    .payment-row > b small { color: var(--quiet); font: 700 9px/1 var(--font-mono); }

    .decision-table { margin-top: 22px; border-top: 1px solid var(--rule); }
    .decision-head, .decision-row { display: grid; grid-template-columns: .72fr 1.45fr .72fr .55fr .42fr; gap: 16px; align-items: center; }
    .decision-head { padding: 10px 14px; color: var(--quiet); font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .decision-row { min-height: 84px; padding: 13px 14px; border-top: 1px solid var(--rule); }
    .decision-row strong { font-size: 12px; }
    .decision-row p { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .decision-row span { color: var(--ink-2); font-size: 10px; line-height: 1.3; }
    .decision-row b { width: max-content; padding: 5px 8px; border-radius: 999px; color: var(--critical); background: #2B171B; font: 800 10px/1 var(--font-mono); }
    .decision-row .decision-ready { color: var(--positive); background: #14291F; }
    .close-cta { display: grid; grid-template-columns: 180px 1fr; gap: 20px; align-items: center; margin-top: 20px; padding: 15px 18px; border: 1px solid var(--brand-dark); border-radius: var(--radius-sm); background: var(--brand-soft); }
    .close-cta span { color: var(--brand-dark); font: 800 9px/1.2 var(--font-mono); text-transform: uppercase; }
    .close-cta strong { font-size: 14px; }
    .close-sources { display: grid; grid-template-columns: 180px 1fr; gap: 20px; margin-top: 14px; color: var(--quiet); font-size: 10px; line-height: 1.3; }
    .close-sources span { font: 700 9px/1.2 var(--font-mono); text-transform: uppercase; }

    .page[data-page="13"] .page-content, .page[data-page="18"] .page-content { display: flex; flex-direction: column; justify-content: center; }

    .evidence-positive { color: var(--positive); background: #14291F; }
    .evidence-warning { color: var(--warning); background: #2A2314; }
    .evidence-neutral { color: var(--ink-2); background: #292433; }
    .note-positive { color: var(--positive); background: #14291F; }
    .note-warning { color: var(--warning); background: #2A2314; }
    .commercial-data, .source-data { overflow: visible; }
  `;
}

/**
 * Build the Marketplace Dark Premium v4 21-page KP proposal HTML.
 *
 * This renderer is intentionally pure: it performs no I/O, network access, or
 * mutation. The caller remains responsible for PDF rendering and artifact QA.
 */
export function buildPremiumProposalHtml({
  question = "",
  selected = [],
  allProjects = [],
  themeTokens = {},
  proposalModel = {},
} = {}) {
  const model = proposalModel || {};
  const theme = themeFromTokens(themeTokens || {});
  const context = projectContext({ question, selected, allProjects, proposalModel: model });
  const narrative = narrativeFromModel(model);
  const claims = claimLedgerFromModel(model);
  const sources = normalizedSources(model);
  const scope = normalizedScope(model, context.project);
  const evidence = evidenceState(model, sources, claims);

  const pages = [
    coverPage({ context, model, theme, scope, evidence, sources }),
    trustThreadPage({ context, scope }),
    whyNowPage({ context, model, scope, claims, evidence }),
    handoffProblemPage({ context, model, scope, narrative }),
    marketResearchPage({ context, model, claims, sources, evidence }),
    marketPage({ context, model, sources }),
    analogResearchPage({ context, model }),
    launchThesisPage({ context, model, scope }),
    productChapterPage({ context, scope }),
    productMapPage({ context, model, scope }),
    designPage({ context, model, theme }),
    journeyPage({ context, model, scope }),
    architecturePage({ context, model, scope }),
    swotPage({ context, model }),
    deliveryChapterPage({ context, model }),
    functionPricePage({ context, model, scope }),
    teamPage({ context, model }),
    roadmapPage({ context, model }),
    projectPricePage({ context, model }),
    paymentPage({ context, model }),
    closePage({ context, model, sources, scope }),
  ];

  return `<!doctype html>
<html lang="${escapeHtml(String(context.locale || "en").replace(/[^a-z0-9-]/gi, "").slice(0, 20) || "en")}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(context.title)} · Commercial KP</title>
  <style>${styles(theme)}</style>
</head>
<body>
${pages.join("\n")}
</body>
</html>`;
}

export default buildPremiumProposalHtml;
