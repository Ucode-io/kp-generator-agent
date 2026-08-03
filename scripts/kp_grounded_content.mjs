import "dotenv/config";
import path from "node:path";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { sourceOriginKey } from "./kp_source_domains.mjs";
import { assertsSellerManagement, hasDirectSellerManagementEvidence } from "./kp_seller_entailment.mjs";

export const KP_CONTENT_SCHEMA_VERSION = "2.0";

function compact(value = "", limit = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values.map((item) => compact(item, 220)).filter(Boolean)) {
    const key = value.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function fact(value, status = "explicit", quote = "", sourceId = "SRC-PROMPT") {
  const finalStatus = value === null || value === "" ? "unknown" : status;
  return {
    value: value ?? null,
    status: finalStatus,
    confidence: finalStatus === "explicit" ? "high" : finalStatus === "assumed" ? "low" : finalStatus === "unknown" ? "low" : "medium",
    evidenceRefs: quote ? [{ sourceId, locator: "request", quote: compact(quote, 280) }] : [],
  };
}

function normalizeBareUrl(value = "") {
  const clean = compact(value, 300).replace(/^[('"\[]+|[)'"\],;!?]+$/g, "");
  if (!clean) return "";
  const candidate = /^https?:\/\//i.test(clean) ? clean : /^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(clean) ? `https://${clean}` : "";
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function hostProductName(url = "") {
  try {
    const token = new URL(url).hostname.replace(/^www\./i, "").split(".")[0] || "";
    return token ? token.charAt(0).toUpperCase() + token.slice(1) : "";
  } catch {
    return "";
  }
}

function cleanProjectName(value = "") {
  return compact(value, 100)
    .replace(/\b(?:analog|scope|funksional|budget|budjet|byudjet|duration|timeline|muddat|kp|kpi|pdf)\b[\s\S]*$/i, "")
    .replace(/\b(?:qil|qiber|ber|kerak|kere|kjere|sdelay|generate|premium)\b[\s\S]*$/i, "")
    .replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, "")
    .trim()
    .slice(0, 72);
}

function extractProjectName(text = "") {
  const patterns = [
    /\b(?:oti|nomi|name|called|named|название)\s+([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9._-]{1,50})\b/u,
    /\b(?:yangi\s+(?:loyiha|loyixa|project)|new\s+project|новый\s+проект)\s*[:=-]\s*([^.;\n]{2,90})/iu,
    /\b(?:project\s+name|project\s+nomi|loyiha\s+nomi|название)\s*[:=-]\s*([^.;\n]{2,90})/iu,
  ];
  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    const value = cleanProjectName(match?.[1] || "");
    if (value && !/^(?:project|loyiha|kp|kpi|pdf)$/i.test(value)) return { value, quote: match[0] };
  }
  return { value: "", quote: "" };
}

function cleanAnalogName(value = "") {
  return compact(value, 100)
    .replace(/\b(?:ga|dek|kabi)\s+(?:o['’]?xshagan|oxshagan|uxshagan|o['’]?xshash)\b.*$/i, "")
    .replace(/\b(?:scope|budget|budjet|byudjet|duration|timeline|muddat|kp|kpi|pdf)\b[\s\S]*$/i, "")
    .replace(/^[\s:;,.-]+|[\s:;,.-]+$/g, "")
    .trim();
}

function extractAnalog(text = "") {
  const source = String(text || "");
  const forward = source.match(/\b(?:analog|аналог|benchmark|raqobatchi|like|kak|как)\s*[:=-]?\s*(https?:\/\/[^\s<>)"]+|[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s,;]*)?|[^,.;\n]{2,80})/iu);
  const reverseDomain = source.match(/\b(https?:\/\/[^\s<>)"]+|[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s,;]*)?)\s+(?:ga\s+)?(?:o['’]?xshagan|oxshagan|uxshagan|o['’]?xshash|dek|kabi)\b/iu);
  const reverseName = source.match(/\b([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9_-]*(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9_-]*){0,3})\s+(?:ga\s+)?(?:o['’]?xshagan|oxshagan|uxshagan|o['’]?xshash|dek|kabi)\b/u);
  const reverse = reverseDomain || reverseName;
  const match = forward || reverse;
  if (!match) return { name: fact(null), url: fact(null), relation: "unknown" };
  const raw = cleanAnalogName(match[1]);
  const url = normalizeBareUrl(raw);
  const name = url ? hostProductName(url) : raw;
  return {
    name: fact(name || null, "explicit", match[0]),
    url: fact(url || null, "explicit", match[0]),
    relation: "product_analog",
  };
}

function parseScaledNumber(rawValue = "", rawMultiplier = "") {
  const normalized = String(rawValue || "")
    .replace(/\s+/g, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/[^\d.]/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = String(rawMultiplier || "").toLowerCase();
  const scale = /^(?:k|к|ming|тыс)$/iu.test(multiplier)
    ? 1_000
    : /^(?:m|mln|million|million|млн|миллион)$/i.test(multiplier)
      ? 1_000_000
      : /^(?:b|bn|mlrd|billion|млрд|миллиард)$/i.test(multiplier)
        ? 1_000_000_000
        : 1;
  return Math.round(value * scale);
}

function currencyFrom(value = "") {
  if (/\$|\busd\b|dollar|доллар/i.test(value)) return "USD";
  if (/\buzs\b|so['’]?m|\bsum\b|сум/i.test(value)) return "UZS";
  if (/\beur\b|€/i.test(value)) return "EUR";
  return "";
}

function extractBudget(text = "", defaultCurrency = "", allowDefaultCurrencyAssumption = false) {
  const source = String(text || "").replace(/\s+/g, " ");
  // Russian-speaking users often write a scaled currency as `100$к`.  Keep
  // that exact quote for provenance while treating it the same as `$100k` or
  // `100k$`.  Unicode lookarounds are used because JavaScript `\b` does not
  // recognize Cyrillic letters as word characters.
  const labelledCurrencyThenMultiplier = source.match(/(?<![\p{L}\p{N}_])(?:budget|budjet|byudjet|бюджет)(?:im|imiz|i)?\s*[:=-]?\s*(\d+(?:[.,]\d+)?)\s*(\$|usd|dollar|доллар|uzs|so['’]?m|sum|сум|eur|€)\s*(k|к|ming|тыс|m|mln|million|млн|миллион|b|bn|mlrd|млрд|billion|миллиард)(?![\p{L}\p{N}_])/iu);
  const labelled = source.match(/(?<![\p{L}\p{N}_])(?:budget|budjet|byudjet|бюджет)(?:im|imiz|i)?\s*[:=-]?\s*(\d+(?:[.,]\d+)?)\s*(k|к|ming|тыс|m|mln|million|млн|миллион|b|bn|mlrd|млрд|billion|миллиард)?\s*(\$|usd|dollar|доллар|uzs|so['’]?m|sum|сум|eur|€)?/iu);
  const currencyThenMultiplier = source.match(/(?<![\p{L}\p{N}_])(\d+(?:[.,]\d+)?)\s*(\$|usd|dollar|доллар|uzs|so['’]?m|sum|сум|eur|€)\s*(k|к|ming|тыс|m|mln|million|млн|миллион|b|bn|mlrd|млрд|billion|миллиард)(?![\p{L}\p{N}_])/iu);
  const currencyBound = source.match(/(?:\$|usd|dollar|доллар|uzs|so['’]?m|sum|сум|eur|€)\s*(\d+(?:[.,]\d+)?)\s*(k|к|ming|тыс|m|mln|million|млн|миллион|b|bn|mlrd|млрд|billion|миллиард)?|(?<![\p{L}\p{N}_])(\d+(?:[.,]\d+)?)\s*(k|к|ming|тыс|m|mln|million|млн|миллион|b|bn|mlrd|млрд|billion|миллиард)?\s*(\$|usd|dollar|доллар|uzs|so['’]?m|sum|сум|eur|€)/iu);
  let amount = null;
  let quote = "";
  let explicitCurrency = "";
  if (labelledCurrencyThenMultiplier) {
    amount = parseScaledNumber(labelledCurrencyThenMultiplier[1], labelledCurrencyThenMultiplier[3]);
    quote = labelledCurrencyThenMultiplier[0];
    explicitCurrency = currencyFrom(labelledCurrencyThenMultiplier[2]);
  } else if (labelled) {
    amount = parseScaledNumber(labelled[1], labelled[2]);
    quote = labelled[0];
    explicitCurrency = currencyFrom(labelled[3] || labelled[0]);
  } else if (currencyThenMultiplier) {
    amount = parseScaledNumber(currencyThenMultiplier[1], currencyThenMultiplier[3]);
    quote = currencyThenMultiplier[0];
    explicitCurrency = currencyFrom(currencyThenMultiplier[2]);
  } else if (currencyBound) {
    const value = currencyBound[1] || currencyBound[3];
    const multiplier = currencyBound[2] || currencyBound[4];
    amount = parseScaledNumber(value, multiplier);
    quote = currencyBound[0];
    explicitCurrency = currencyFrom(currencyBound[0]);
  }
  if (!amount) {
    return {
      amount: fact(null),
      currency: fact(null),
      usdAmount: null,
    };
  }
  // A bare amount is still a useful client input, but it is not money until the
  // currency is known.  In particular, do not silently turn colloquial `150k`
  // into a USD commercial commitment just because the deployment has a default
  // display currency configured.  The old behaviour can only be requested via
  // the explicit opt-in used by legacy callers.
  const currency = explicitCurrency || (allowDefaultCurrencyAssumption ? defaultCurrency : "") || "";
  const currencyStatus = explicitCurrency ? "explicit" : currency ? "assumed" : "unknown";
  return {
    amount: fact(amount, "explicit", quote),
    currency: fact(currency || null, currencyStatus, quote),
    usdAmount: currency === "USD" ? amount : null,
  };
}

function extractTimeline(text = "") {
  const match = String(text || "").match(/(?<![\p{L}\p{N}_])(\d+(?:[.,]\d+)?)\s*(oy(?:da|lik)?|months?|mo(?![\p{L}\p{N}_])|месяц(?:а|ев)?|hafta(?:da|lik)?|weeks?|недел(?:я|и|ь))(?![\p{L}\p{N}_])/iu);
  if (!match) return { months: fact(null), original: fact(null) };
  const value = Number(match[1].replace(",", "."));
  const months = /hafta|week|недел/i.test(match[2]) ? Math.max(0.25, value / 4.345) : value;
  return { months: fact(months, "explicit", match[0]), original: fact(match[0], "explicit", match[0]) };
}

const scopeMatchers = [
  ["Food ordering app", /food\s*order|ovqat\s*buyurtma|заказ\s*ед/i],
  ["Restaurant admin panel", /restoran|restaurant|ресторан/i],
  ["Courier app", /courier|kuryer|курьер/i],
  ["E-commerce", /e-?commerce|online\s+store|internet\s+shop|internet\s+magazin|onlayn\s+magazin|(?:internet|onlayn)\s+do['’]?kon|интернет[- ]?магазин|онлайн[- ]?магазин/i],
  ["Marketplace", /marketplace|seller|vendor|buyer|маркетплейс/i],
  ["SaaS", /\bsaas\b|software\s+as\s+a\s+service/i],
  ["Customer mobile app", /customer\s+(?:mobile\s+)?app|client\s+app|mijoz\s+ilova/i],
  ["Mobile app", /mobile|mobilka|mobilkasi|ios|android|прилож/i],
  ["Admin panel", /admin|админ/i],
  ["Website", /website|websitye|websayt|web\s*site|сайт/i],
  ["CRM", /\bcrm\b|lead\s+pipeline/i],
  ["ERP", /\berp\b/i],
  ["Payment", /payment|payme|click|stripe|to['’]?lov|оплат/i],
  ["Promo code engine", /promo\s*code|promokod|промокод/i],
  ["Analytics dashboard", /analytics|dashboard|hisobot|report|отч[её]т/i],
  ["Telegram bot", /telegram|\bbot\b/i],
  ["AI module", /\bai\b|\bllm\b|gpt|claude|искусствен/i],
  ["External API integrations", /\bapi\b|integration|integrats|интеграц/i],
  ["TMS core", /\btms\b|fleet|shipment|dispatch|transport\s+management/i],
];

function normalizeScopeChunk(chunk = "") {
  const value = compact(chunk, 120)
    .replace(/^(?:and|va|hamda|и)\s+/i, "")
    .replace(/\b(?:qil|qiber|kerak|kere|bolishi|bo['’]?lishi)\b.*$/i, "")
    .trim();
  if (!value || value.length < 2) return "";
  for (const [label, pattern] of scopeMatchers) {
    if (pattern.test(value)) {
      if (/restaurant|restoran|ресторан/i.test(value) && /admin|panel|cabinet|кабинет/i.test(value)) return "Restaurant admin panel";
      if (/courier|kuryer|курьер/i.test(value) && /app|mobile|ilova|прилож/i.test(value)) return "Courier app";
      return label;
    }
  }
  return value.split(" ").map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part).join(" ");
}

function extractScope(text = "") {
  const source = String(text || "")
    .replace(/(?:^|[\r\n])\s*(?:сайт\s+компании|company\s+(?:website|site))\s*[:=-]\s*[^\r\n]*/giu, "\n")
    .replace(/\s+/g, " ");
  const explicitMatch = source.match(/\b(?:scope|funksional|functional|modules?|модули?|функционал)\s*[:=-]\s*([\s\S]+?)(?=\b(?:budget|budjet|byudjet|бюджет|duration|timeline|muddat|срок|kp|kpi)\b|$)/iu);
  const explicitChunks = explicitMatch
    ? explicitMatch[1].split(/[,;|]+|\s+\+\s+|\s+va\s+|\s+hamda\s+|\s+и\s+/iu).map(normalizeScopeChunk).filter(Boolean)
    : [];
  const keywordItems = scopeMatchers.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
  if (/restaurant|restoran|ресторан/i.test(source) && /admin|panel|cabinet|кабинет/i.test(source)) keywordItems.push("Restaurant admin panel");
  if (/courier|kuryer|курьер/i.test(source) && /app|mobile|ilova|прилож/i.test(source)) keywordItems.push("Courier app");
  const items = uniqueStrings([...explicitChunks, ...keywordItems]);
  return items.map((item) => ({ ...fact(item, explicitMatch ? "explicit" : "inferred", explicitMatch?.[0] || item), inclusion: explicitMatch ? "requested" : "detected" }));
}

function detectCategory(text = "", scope = [], analogName = "") {
  const declaredType = extractDeclaredProjectType(text);
  const explicitCategory = categoryForDeclaredProjectType(declaredType);
  if (explicitCategory) return explicitCategory;
  const combined = `${text} ${scope.map((item) => item.value).join(" ")} ${analogName}`.toLowerCase();
  if (/restaurant|restoran|courier|kuryer|food\s*delivery|yandex\s*eats|express24|wolt/.test(combined)) return "Food delivery marketplace";
  if (/cashback|loyalty|bonus|reward|wallet|merchant|payout/.test(combined)) return "Cashback / loyalty product";
  if (/\berp\b|enterprise\s+resource\s+planning|планировани[ея]\s+ресурс/.test(combined)) return "ERP / operations platform";
  if (/\btms\b|transport\s+management|fleet\s+management|управлени[ея]\s+транспорт/.test(combined)) return "TMS / logistics platform";
  if (/\bsaas\b|software\s+as\s+a\s+service|subscription\s+platform/.test(combined)) return "SaaS product";
  if (/e-?commerce|online\s+store|internet\s+shop|internet\s+magazin|onlayn\s+magazin|(?:internet|onlayn)\s+do['’]?kon|интернет[- ]?магазин|онлайн[- ]?магазин/.test(combined)) return "E-commerce product";
  if (/marketplace|seller|vendor|buyer|маркетплейс/.test(combined)) return "Marketplace product";
  if (/\bcrm\b|lead\s+pipeline|sales\s+automation/.test(combined)) return "CRM / operations platform";
  if (/mobile\s+app|mobile\s+application|ios|android|мобильн\p{L}*\s+приложен/u.test(combined)) return "Mobile product";
  if (/website|websitye|websayt|site/.test(combined)) return "Web product";
  return "Custom software product";
}

function extractDeclaredProjectType(text = "") {
  const match = String(text).match(/(?:^|[\r\n])\s*(?:тип\s+проекта|project\s+type|loyiha\s+turi)\s*[:=-]\s*([^\r\n;]+)/iu);
  return match?.[1]?.trim() || "";
}

function categoryForDeclaredProjectType(value = "") {
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return "";
  if (/\berp\b|enterprise\s+resource\s+planning|планировани[ея]\s+ресурс/.test(normalized)) return "ERP / operations platform";
  if (/\btms\b|transport\s+management|fleet\s+management|управлени[ея]\s+транспорт/.test(normalized)) return "TMS / logistics platform";
  if (/\bcrm\b|customer\s+relationship|управлени[ея]\s+клиент/.test(normalized)) return "CRM / operations platform";
  if (/\bsaas\b|software\s+as\s+a\s+service/.test(normalized)) return "SaaS product";
  if (/marketplace|маркетплейс|маркет\s+плейс/.test(normalized)) return "Marketplace product";
  if (/e-?commerce|online\s+store|internet\s+shop|internet\s+magazin|onlayn\s+magazin|(?:internet|onlayn)\s+do['’]?kon|интернет[- ]?магазин|онлайн[- ]?магазин/.test(normalized)) return "E-commerce product";
  if (/mobile\s+app|mobile\s+application|ios|android|мобильн\p{L}*\s+приложен/u.test(normalized)) return "Mobile product";
  if (/^website$|^web\s*site$|веб[- ]?сайт|вебсайт/.test(normalized)) return "Web product";
  if (/^other$|^другое$|^бошқа$|^boshqa$/.test(normalized)) return "Custom software product";
  if (/fintech|bnpl|bank|finance|финтех|банк/.test(normalized)) return "Fintech product";
  return "";
}

function detectBriefLanguage(text = "") {
  return /[а-яё]/i.test(text)
    ? "ru"
    : /\b(?:manga|kere|kerak|qiber|qber|loyiha|budjet|oyda|o['’]?xsh\w*|oxsh\w*)\b/i.test(text)
      ? "uz-Latn"
      : "en";
}

function workingTitleFor(category = "", locale = "en") {
  const en = {
    "Food delivery marketplace": "Food delivery platform",
    "Marketplace product": "Marketplace platform",
    "E-commerce product": "E-commerce store",
    "ERP / operations platform": "ERP platform",
    "SaaS product": "SaaS platform",
    "Fintech product": "Fintech platform",
    "Cashback / loyalty product": "Cashback platform",
    "CRM / operations platform": "CRM platform",
    "TMS / logistics platform": "Logistics platform",
    "Mobile product": "Mobile product",
    "Web product": "Web product",
  };
  const uz = {
    "Food delivery marketplace": "Ovqat yetkazib berish platformasi",
    "Marketplace product": "Marketpleys platformasi",
    "E-commerce product": "E-commerce do‘koni",
    "ERP / operations platform": "ERP platformasi",
    "SaaS product": "SaaS platformasi",
    "Fintech product": "Fintech platformasi",
    "Cashback / loyalty product": "Keshbek platformasi",
    "CRM / operations platform": "CRM platformasi",
    "TMS / logistics platform": "Logistika platformasi",
    "Mobile product": "Mobil mahsulot",
    "Web product": "Veb mahsulot",
  };
  const ru = {
    "Food delivery marketplace": "Платформа доставки еды",
    "Marketplace product": "Платформа маркетплейса",
    "E-commerce product": "Интернет-магазин",
    "ERP / operations platform": "ERP-платформа",
    "SaaS product": "SaaS-платформа",
    "Fintech product": "Финтех-платформа",
    "Cashback / loyalty product": "Кешбэк-платформа",
    "CRM / operations platform": "CRM-платформа",
    "TMS / logistics platform": "Логистическая платформа",
    "Mobile product": "Мобильный продукт",
    "Web product": "Веб-продукт",
  };
  if (locale === "uz-Latn") return uz[category] || "Maxsus dasturiy loyiha";
  if (locale === "ru") return ru[category] || "Заказной программный проект";
  return en[category] || "Custom software project";
}

const requestedSectionPatterns = Object.freeze({
  problem: /(?:\bproblem\b|\bpain\b|muammo|проблем|боль)/iu,
  market_research: /(?:market\s*(?:research|analysis)|bozor\s*(?:tahlil|tadqiq)|анализ\s+рынка|исследовани[ея]\s+рынка)/iu,
  market_sizing: /(?:\bTAM\b|\bSAM\b|\bSOM\b|market\s*size|bozor\s*hajm|размер\s+рынка)/iu,
  analog_research: /(?:analog|benchmark|reference|referens|o['’]?xshagan|oxshagan|аналог|референс)/iu,
  product_map: /(?:product\s*(?:map|mind\s*map)|mind\s*map|mahsulot\s*xarita|карта\s+продукта|майндмэп|mindmap)/iu,
  primary_flow: /(?:\bBPMN\b|user\s*flow|process\s*flow|asosiy\s*jarayon|бизнес[- ]?процесс)/iu,
  architecture: /(?:infra(?:structure)?\s*diagram|architecture|arxitektura|инфраструктур|архитектур)/iu,
  org_structure: /(?:org(?:anization)?\s*structure|organizational\s*chart|орг(?:анизационн)?\s*структур|структур[аы]\s+компани)/iu,
  client_dependencies: /(?:client\s*dependenc|from\s+client|ot\s+klienta|от\s+клиента\s+(?:жд[её]м|нужно)|mijozdan\s+(?:kerak|kutil))/iu,
  function_price: /(?:function(?:al)?\s*(?:price|cost)|feature\s*(?:price|cost)|funksiya\s*narx|стоимост[ьи]\s+функц)/iu,
  team: /(?:team\s*size|team\s*plan|jamoa|команд[аы]|\bFTE\b)/iu,
  roadmap: /(?:roadmap|timeline|delivery\s*plan|yo['’]?l\s*xarita|этап[ыа]\s+разработ|дорожн[ая]\s+карт|muddat|срок)/iu,
  // A budget constraint ("budjet 150k") is an input fact, not a request for a
  // commercial price page; only price-specific wording requests the surface.
  project_price: /(?:project\s*(?:price|cost)|loyiha\s*narx|стоимост[ьи]\s+проекта|цена\s+проекта|сумма\s+проекта|\bquote\b)/iu,
  payments: /(?:payment\s*(?:schedule|stage|plan)|to['’]?lov\s*(?:jadval|bosqich)|график\s+платеж|этап[ыа]\s+оплат)/iu,
});

export function detectRequestedKpSections(text = "") {
  return Object.entries(requestedSectionPatterns)
    .filter(([, pattern]) => pattern.test(String(text || "")))
    .map(([kind]) => kind);
}

export function parseKpBrief(text = "", options = {}) {
  const sourceLanguage = detectBriefLanguage(text);
  const defaultCurrency = options.defaultCurrency ?? process.env.KP_DEFAULT_CURRENCY ?? "USD";
  const project = extractProjectName(text);
  const analog = extractAnalog(text);
  const budget = extractBudget(text, defaultCurrency, options.allowDefaultCurrencyAssumption === true);
  const timeline = extractTimeline(text);
  const scope = extractScope(text);
  const category = detectCategory(text, scope, analog.name.value || "");
  const explicitBrand = String(text).match(/\b(?:brand|brend|brandbook|style|palette|rang|color|visual\s+reference)\s*[:=-]?\s*(https?:\/\/[^\s<>)"]+|[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s,;]*)?)/iu);
  // "КП для <url>" / "<url> uchun KP" names the client's own product site.
  // That site is the authoritative palette/typography source even though the
  // user never says the word "brand".
  // NB: \b does not work before Cyrillic letters (ASCII word boundaries), so
  // the connective is anchored to whitespace/start explicitly.
  const clientSiteMatch = String(text).match(/(?:^|[\s(«"'>])(?:для|dlya|for)\s+(https?:\/\/[^\s<>)"]+)/iu)
    || String(text).match(/(https?:\/\/[^\s<>)"]+)\s+(?:uchun|учун)(?:$|[\s.,;!?)»"'<])/iu);
  const clientSiteUrl = normalizeBareUrl((clientSiteMatch?.[1] || "").replace(/[.,;!?]+$/g, ""));
  const brandUrl = normalizeBareUrl(explicitBrand?.[1] || "")
    || (clientSiteUrl && clientSiteUrl !== analog.url.value ? clientSiteUrl : "");
  const analogAsVisualDirection = Boolean(analog.url.value) && (
    /https?:\/\/[^\s<>)"]+\s+(?:ga\s+)?(?:o['’]?xshagan|oxshagan|uxshagan|o['’]?xshash|dek|kabi)\b/iu.test(text)
    || /\b(?:like|как|сделай\s+как)\s+https?:\/\//iu.test(text)
  );
  const allUrls = [...String(text || "").matchAll(/https?:\/\/[^\s<>)"]+/gi)].map((match) => match[0].replace(/[.,;!?]+$/g, ""));
  const referenceHint = (role, url, quote) => ({
    url: fact(url || null, url ? "explicit" : "unknown", quote || ""),
    role,
  });
  const brandReferences = brandUrl ? [referenceHint("brand_system", brandUrl, explicitBrand?.[0] || clientSiteMatch?.[0] || "")] : [];
  // Every remaining URL is still a legitimate palette/typography source: the
  // renderer only ever consumes colors and font families from a reference
  // URL, so an unclassified link must not silently fall back to the static
  // default theme.
  const visualStyleReferences = allUrls
    .filter((url) => url !== brandUrl)
    .filter((url) => url === analog.url.value
      ? analogAsVisualDirection
      : true)
    .map((url) => referenceHint("visual_style", url, url));
  const productAnalogs = analog.name.value ? [{ name: analog.name, relation: "product_analog" }] : [];
  return {
    schemaVersion: KP_CONTENT_SCHEMA_VERSION,
    sourceLanguage,
    projectName: fact(project.value || null, "explicit", project.quote),
    workingTitle: fact(project.value || workingTitleFor(category, sourceLanguage), project.value ? "explicit" : "assumed", project.quote || category),
    productCategory: fact(category, /Custom/.test(category) ? "inferred" : "inferred", category),
    analog,
    brandReference: {
      url: fact(brandUrl || null, "explicit", explicitBrand?.[0] || ""),
      relation: brandUrl ? "visual_reference" : "unknown",
    },
    brandReferences,
    visualStyleReferences,
    productAnalogs,
    budget,
    timeline,
    scope,
    requestedSections: detectRequestedKpSections(text),
    geography: fact(options.defaultGeography || null, options.defaultGeography ? "assumed" : "unknown", ""),
    openQuestions: [
      !project.value ? "Project name is not explicit; a working title is used." : "",
      budget.amount.value && budget.currency.status === "assumed" ? `Budget currency is not explicit; ${budget.currency.value} is a configured assumption.` : "",
      budget.amount.value && budget.currency.status === "unknown" ? "Budget amount is explicit, but its currency must be confirmed before commercial acceptance." : "",
      !budget.amount.value ? "Budget is not provided." : "",
      !timeline.months.value ? "Delivery timeline is not provided." : "",
    ].filter(Boolean),
  };
}

export function bindBriefSourceIds(brief = {}, sourceId = "SRC-PROMPT") {
  return JSON.parse(JSON.stringify(brief).replaceAll("SRC-PROMPT", sourceId || "SRC-PROMPT"));
}

export function getDomainResearchPacks(input = "") {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  const lower = text.toLowerCase();
  const declaredCategory = categoryForDeclaredProjectType(extractDeclaredProjectType(text));
  const matchesType = (category, pattern) => declaredCategory
    ? declaredCategory === category
    : pattern.test(lower);
  const packs = [];
  if ((!declaredCategory || declaredCategory === "Marketplace product")
    && /restaurant|restoran|courier|kuryer|food\s*delivery|yandex\s*eats|express24|wolt|ресторан|курьер|доставк\p{L}*\s+ед|ед\p{L}*\s+доставк/u.test(lower)) {
    packs.push({
      key: "food-delivery",
      industry: "Food delivery marketplace",
      analog: "Yandex Eats / Wolt / local delivery products",
      description: "A three-sided ordering product connecting customers, restaurants, couriers and operations.",
      scope: [
        "Customer ordering and address flow",
        "Restaurant catalog, menu and availability management",
        "Restaurant order acceptance and preparation status",
        "Courier onboarding and availability",
        "Courier assignment, pickup and delivery status",
        "Delivery zone and fee rules",
        "Live order tracking",
        "Promo code and campaign rules",
        "Payment, refund and reconciliation statuses",
        "Support and dispute workflow",
        "Admin dispatch and moderation workspace",
        "Restaurant and courier performance analytics",
      ],
      blockers: [
        { name: "Delivery operating model", status: "Zones, fees, courier assignment and SLA rules must be confirmed" },
        { name: "Restaurant onboarding rules", status: "Menu, availability, commission and settlement rules must be confirmed" },
        { name: "Maps and geocoding provider", status: "Coverage, routing API and commercial limits must be confirmed" },
      ],
      infrastructure: [
        { component: "Maps / geocoding", type: "Third-party API", cost: "Provider quote required", period: "Usage based" },
        { component: "Push notifications", type: "Firebase / APNs", cost: "Usage policy applies", period: "Usage based" },
        { component: "Payment provider", type: "Third-party API", cost: "Provider fee", period: "Per transaction" },
      ],
    });
  }
  const marketplaceIntent = matchesType("Marketplace product", /marketplace|marketpleys|seller|vendor|buyer|uzum|маркетплейс|маркет-?плейс|продавц|покупател/u);
  const ecommerceIntent = matchesType("E-commerce product", /e-?commerce|online\s+store|internet\s+shop|internet\s+magazin|onlayn\s+magazin|(?:internet|onlayn)\s+do['’]?kon|интернет-?магазин|онлайн-?магазин/u);
  if (ecommerceIntent && !marketplaceIntent && !packs.some((pack) => pack.key === "food-delivery")) {
    packs.push({
      key: "ecommerce",
      industry: "E-commerce product",
      analog: "Direct-to-customer online stores",
      description: "A single-merchant online store covering storefront, catalog, checkout, fulfilment and store operations.",
      scope: [
        "Storefront, categories, search and filters",
        "Product cards, variants and availability",
        "Cart, promo codes and checkout",
        "Customer registration and profile",
        "Payment and delivery methods",
        "Order fulfilment and notifications",
        "Returns and customer support",
        "Store catalog and inventory management",
        "Promotions and content management",
        "Sales and conversion analytics",
      ],
      blockers: [
        { name: "Store fulfilment rules", status: "Stock reservation, delivery zones and return policy must be confirmed" },
        { name: "Catalog ownership", status: "Product content, pricing and inventory ownership must be confirmed" },
      ],
      infrastructure: [
        { component: "Search service", type: "Application service", cost: "Architecture estimate required", period: "Monthly" },
        { component: "Object storage / CDN", type: "Cloud service", cost: "Usage based", period: "Monthly" },
      ],
    });
  }
  if (marketplaceIntent && !packs.some((pack) => pack.key === "food-delivery")) {
    packs.push({
      key: "marketplace",
      industry: "Marketplace product",
      analog: "Regional marketplace products",
      description: "A multi-sided commerce product covering buyer, seller, catalog, order and moderation operations.",
      scope: [
        "Catalog, categories, search and filters",
        "Product cards and variants",
        "Cart and checkout",
        "Order lifecycle and notifications",
        "Buyer registration and profile",
        "Seller onboarding and verification",
        "Seller product and inventory management",
        "Commission and settlement rules",
        "Returns, disputes and moderation",
        "Admin catalog and user operations",
        "Marketplace analytics and exports",
      ],
      blockers: [
        { name: "Marketplace commercial rules", status: "Commission, settlement, returns and seller policy must be confirmed" },
        { name: "Catalog ownership", status: "Category, attribute and content moderation ownership must be confirmed" },
      ],
      infrastructure: [
        { component: "Search service", type: "Application service", cost: "Architecture estimate required", period: "Monthly" },
        { component: "Object storage / CDN", type: "Cloud service", cost: "Usage based", period: "Monthly" },
      ],
    });
  }
  if (matchesType("ERP / operations platform", /\berp\b|enterprise\s+resource\s+planning|планировани[ея]\s+ресурс/u)) {
    packs.push({
      key: "erp",
      industry: "ERP / operations platform",
      analog: "Enterprise resource planning systems",
      description: "An internal operations platform covering procurement, inventory, finance, production and governance.",
      scope: [
        "Procurement requests and approvals",
        "Supplier and purchase order management",
        "Goods receipt and warehouse operations",
        "Inventory, reservations and stock movements",
        "Customer orders and shipment planning",
        "Invoices, payments and expense control",
        "Budget plan-versus-actual control",
        "Production plans and work orders",
        "Operational and financial reporting",
        "Roles, permissions, audit and integrations",
      ],
      blockers: [
        { name: "Accounting model", status: "Organizations, chart of accounts, currencies and tax rules must be confirmed" },
        { name: "Master data", status: "Item, supplier, warehouse and cost-center ownership must be confirmed" },
      ],
      infrastructure: [],
    });
  }
  if (matchesType("CRM / operations platform", /\bcrm\b|\bсрм\b|lead\s+pipeline|sales\s+automation|воронк\p{L}*\s+продаж|автоматизаци\p{L}*\s+продаж/u)) {
    packs.push({
      key: "crm",
      industry: "CRM / operations platform",
      analog: "Sales CRM products",
      description: "A role-based sales operating system covering leads, communication, tasks, stages and reporting.",
      scope: [
        "Lead intake and deduplication",
        "Pipeline stages and transition rules",
        "Client and contact profiles",
        "Tasks, reminders and overdue control",
        "Communication timeline",
        "Role-based access and audit log",
        "Sales dashboards and funnel reports",
        "Import, export and integration APIs",
      ],
      blockers: [
        { name: "Sales process definition", status: "Pipeline stages, mandatory fields and ownership rules must be confirmed" },
        { name: "Migration scope", status: "Source systems, data quality and duplicate rules must be confirmed" },
      ],
      infrastructure: [],
    });
  }
  if (matchesType("SaaS product", /\bsaas\b|software\s+as\s+a\s+service|subscription\s+platform|multi[- ]?tenant/u)) {
    packs.push({
      key: "saas",
      industry: "SaaS product",
      analog: "Subscription-based B2B and B2C software products",
      description: "A subscription software product covering workspaces, collaboration, automation, billing and platform administration.",
      scope: [
        "Workspace and project management",
        "Records, tasks and team collaboration",
        "Templates and workflow automation",
        "Role-based access and invitations",
        "Subscription plans and checkout",
        "Invoices, payment methods and usage limits",
        "API keys, webhooks and integrations",
        "Product analytics and audit trail",
      ],
      blockers: [
        { name: "Tenant model", status: "Workspace ownership, isolation and member roles must be confirmed" },
        { name: "Subscription policy", status: "Plans, limits, trials, upgrades and billing periods must be confirmed" },
      ],
      infrastructure: [
        { component: "Subscription billing", type: "Third-party API", cost: "Provider fee", period: "Per transaction" },
        { component: "Transactional email", type: "Cloud service", cost: "Usage based", period: "Monthly" },
      ],
    });
  }
  if (matchesType("Mobile product", /mobile\s+app|mobile\s+application|ios|android|мобильн\p{L}*\s+приложен/u)) {
    packs.push({
      key: "mobile-app",
      industry: "Mobile product",
      analog: "Native and cross-platform mobile applications",
      description: "A mobile-first product covering onboarding, core user workflows, device capabilities, offline states and release operations.",
      scope: [
        "Mobile onboarding and authentication",
        "Home, discovery and search",
        "Core record creation and review flow",
        "Push notifications and in-app messaging",
        "Camera, media and location permissions",
        "Offline access and data synchronization",
        "Privacy, accessibility and device security",
        "Content, users, campaigns and release administration",
      ],
      blockers: [
        { name: "Platform strategy", status: "iOS, Android and cross-platform implementation priorities must be confirmed" },
        { name: "Offline policy", status: "Cached data, conflict resolution and synchronization rules must be confirmed" },
      ],
      infrastructure: [
        { component: "Push notifications", type: "Firebase / APNs", cost: "Usage policy applies", period: "Usage based" },
        { component: "App distribution", type: "Apple / Google", cost: "Store account fees", period: "Annual" },
      ],
    });
  }
  if (matchesType("Web product", /website|websitye|websayt|web\s*site|веб[- ]?сайт|вебсайт/u)) {
    packs.push({
      key: "website",
      industry: "Web product",
      analog: "Content and lead-generation websites",
      description: "A public website covering information architecture, content journeys, conversion forms, SEO and editorial operations.",
      scope: [
        "Information architecture and responsive page templates",
        "Services, solutions and case-study pages",
        "Blog, articles and author pages",
        "Contact, newsletter and recruitment forms",
        "Search, accessibility and legal pages",
        "CMS page and media management",
        "SEO, localization and redirects",
        "Web analytics and conversion tracking",
      ],
      blockers: [
        { name: "Content ownership", status: "Source content, languages, approval and publishing roles must be confirmed" },
        { name: "Conversion routing", status: "Form recipients, CRM handoff and response SLA must be confirmed" },
      ],
      infrastructure: [
        { component: "CMS and hosting", type: "Cloud service", cost: "Architecture estimate required", period: "Monthly" },
        { component: "Analytics", type: "Third-party service", cost: "Usage policy applies", period: "Monthly" },
      ],
    });
  }
  if (matchesType("TMS / logistics platform", /\btms\b|transport\s+management|fleet\s+management|shipment|dispatch|логистик|автопарк/u)) {
    packs.push({
      key: "tms",
      industry: "TMS / logistics platform",
      analog: "Transport management and fleet operations systems",
      description: "A transport operations platform covering orders, dispatch, routes, fleet, tracking, documents and settlement.",
      scope: [
        "Transport order intake and planning",
        "Shipment and dispatch management",
        "Route planning, mapping and ETA",
        "Fleet, driver and maintenance management",
        "Load, warehouse and dock coordination",
        "Live tracking and proof of delivery",
        "Tariffs, invoices and carrier settlement",
        "Incidents, claims and logistics reporting",
      ],
      blockers: [
        { name: "Transport operating model", status: "Own fleet, carriers, dispatch ownership and SLA rules must be confirmed" },
        { name: "Telematics integration", status: "GPS providers, update frequency and tracking coverage must be confirmed" },
      ],
      infrastructure: [
        { component: "Maps and routing", type: "Third-party API", cost: "Provider quote required", period: "Usage based" },
        { component: "GPS / telematics", type: "Third-party API", cost: "Provider quote required", period: "Usage based" },
      ],
    });
  }
  return packs;
}

export function buildKpResearchQueries(brief = {}, project = {}) {
  const category = brief.productCategory?.value || project.category || project.type || "software product";
  const analog = brief.analog?.name?.value || project.analog || "";
  const geography = brief.geography?.value || project.geography || "Uzbekistan";
  const year = new Date().getUTCFullYear();
  const latestCompleteYear = year - 1;
  const queries = [];
  const requestedSections = new Set(brief.requestedSections || []);
  // Company-level research follows the named reference product when one is
  // supplied (for example Shopify), rather than treating a generic project
  // title such as "Marketplace" as the company being researched.
  const companyOrProduct = analog || brief.projectName?.value || project.title || category;
  const autoCompanyResearch = Boolean(analog)
    && /marketplace|marketpleys|e-?commerce|commerce|маркетплейс|электронн(?:ая|ой)\s+торгов/iu.test(String(category));
  if (analog) {
    queries.push({ id: "analog-official", topic: "analog_features", query: `${analog} official product features ${category}`, priority: "high" });
    queries.push({ id: "analog-business", topic: "analog_business_model", query: `${analog} business model seller restaurant courier pricing commission`, priority: "high" });
  }
  queries.push(
    { id: "market-primary-statistics", topic: "market_size", query: `${geography} e-commerce trade volume annual ${latestCompleteYear} official statistics unit currency`, priority: "high" },
    { id: "market-public-guide", topic: "market_size", query: `${geography} e-commerce market ${latestCompleteYear} USD government statistics`, priority: "high" },
    { id: "market-authoritative", topic: "market_size", query: `${category} market size ${geography} ${latestCompleteYear} official report`, priority: "high" },
    { id: "competitor-landscape", topic: "competitors", query: `${category} competitors ${geography} product comparison`, priority: "medium" },
    { id: "operating-requirements", topic: "requirements", query: `${category} operational requirements payments security integrations`, priority: "medium" },
  );
  if (requestedSections.has("team") || autoCompanyResearch) {
    queries.push({ id: "company-team", topic: "company_team", query: `${companyOrProduct} company engineering team size roles official`, priority: "high" });
  }
  if (requestedSections.has("architecture") || autoCompanyResearch) {
    queries.push({ id: "company-stack", topic: "technology_stack", query: `${companyOrProduct} technology stack architecture engineering official`, priority: "high" });
  }
  if (requestedSections.has("org_structure") || autoCompanyResearch) {
    queries.push({ id: "company-org", topic: "organization", query: `${companyOrProduct} company organization structure leadership teams official`, priority: "high" });
  }
  if (requestedSections.has("function_price") || requestedSections.has("project_price")) {
    queries.push({ id: "commercial-benchmark", topic: "commercial_benchmark", query: `${companyOrProduct} software development pricing rates public`, priority: "medium" });
  }
  const seen = new Set();
  return queries.filter((item) => {
    const key = item.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

export function buildResearchStatus(queryRuns = [], options = {}) {
  if (options.offline) {
    return {
      status: "offline",
      evidenceLevel: "limited",
      reason: options.reason || "Web research was disabled for this run.",
      queries: queryRuns,
      queryCount: queryRuns.length,
      resultCount: 0,
      readCount: 0,
    };
  }
  const resultCount = queryRuns.reduce((sum, item) => sum + Number(item.resultCount || 0), 0);
  const readCount = queryRuns.reduce((sum, item) => sum + Number(item.readCount || 0), 0);
  const status = readCount >= 3 && queryRuns.filter((item) => item.readCount > 0).length >= 2 ? "grounded" : readCount > 0 ? "limited" : "unavailable";
  return {
    status,
    evidenceLevel: status === "grounded" ? "medium" : "limited",
    reason: status === "grounded"
      ? "Multiple research queries returned readable sources."
      : status === "limited"
        ? "Some sources were readable, but coverage was not sufficient for unsupported market claims."
        : "No readable public research source was available.",
    queries: queryRuns,
    queryCount: queryRuns.length,
    resultCount,
    readCount,
  };
}

function safePublicUrl(value = "") {
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return "";
    if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(url.hostname)) return "";
    if (/hrms|udevs-hrms|finance\/salary|\/employees|\/property|\/attendance|\/absence/i.test(`${url.hostname}${url.pathname}`)) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|session|auth|signature|sig|secret|access|^t$|^utm_|gclid|fbclid|ref/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString().replace(/\?$/, "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function isSafeKpReferenceUrl(value = "") {
  const url = safePublicUrl(value);
  if (!url) return false;
  return /figma\.com|canva\.com|docs\.google|drive\.google|\.pdf(?:$|\?)|\/proposal|\/commercial|\/case-stud|\/portfolio|\/project/i.test(url);
}

export function isRelevantHistoricalKpRecord(record = {}, question = "") {
  const text = compact([
    record.text,
    record.caption,
    record.reply_to_text,
    record.chat_title,
  ].filter(Boolean).join(" "), 5000);
  const urls = uniqueStrings([...(Array.isArray(record.urls) ? record.urls : []), ...[...text.matchAll(/https?:\/\/[^\s<>)"]+/gi)].map((match) => match[0])]);
  const hasArtifact = urls.some(isSafeKpReferenceUrl);
  const isOperational = /\b(?:hrms|salary|maosh|attendance|absence|xodim|employee|property|sklad|vacancy|candidate|day\s*off|kech\s+qol)\b/i.test(text);
  if (isOperational && !hasArtifact) return false;
  const hasKp = /\bkp\b|\bкп\b|commercial proposal|коммерческ|proposal|project card/i.test(text);
  const hasUsefulDetail = [
    /budget|budjet|price|narx|сумма|стоим/i,
    /scope|funksional|function|модул/i,
    /payment|оплат|предоплат/i,
    /timeline|duration|muddat|срок/i,
    /client|customer|заказчик|mijoz/i,
  ].filter((pattern) => pattern.test(text)).length >= 2;
  if (!hasArtifact && (!hasKp || !hasUsefulDetail)) return false;
  if (/REAL_KP_TG_TEST|self[- ]?test|test pdf|generator test/i.test(text) && !hasArtifact) return false;
  if (question) {
    const domainTokens = new Set(String(question).toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((token) => token.length >= 5));
    const overlap = [...domainTokens].filter((token) => text.toLowerCase().includes(token)).length;
    if (!hasArtifact && overlap === 0) return false;
  }
  return true;
}

function sourceRank(row = {}) {
  const status = String(row.status || "").toLowerCase();
  if (/verified|read|profiled|extracted|transcribed/.test(status)) return 4;
  if (/provided|downloaded|collected/.test(status)) return 3;
  if (/found/.test(status)) return 1;
  if (/failed|empty/.test(status)) return 0;
  return 2;
}

function clientSafeSource(row = {}) {
  const type = compact(row.type || "source", 60).toLowerCase();
  const researchTopic = compact(row.researchTopic || row.topic || "", 80).toLowerCase();
  const queryId = compact(row.queryId || "", 120);
  let source = compact(row.source || "", 600);
  let label = compact(row.label || "Source", 120);
  // Interstitials and anti-bot pages are observations about access failure, not
  // readable evidence.  Keeping them in the source registry inflated the
  // visible source count and allowed CAPTCHA copy to look like research.
  if (/failed|blocked|captcha|interstitial|empty/i.test(row.status || "")) return null;
  if (/historical_kp_reference/.test(type)) {
    const publicUrl = safePublicUrl(source);
    if (!publicUrl || !isSafeKpReferenceUrl(publicUrl)) return null;
    source = publicUrl;
    label = "Udevs historical KP reference";
  } else if (/^https?:\/\//i.test(source)) {
    source = safePublicUrl(source);
    if (!source) return null;
  } else if (/^(?:telegram|file):\/\//i.test(source)) {
    return null;
  } else if (path.isAbsolute(source)) {
    const fileName = path.basename(source);
    source = `attachment:${fileName}`;
    label = fileName;
  } else if (/password|token|api[_ -]?key|session/i.test(source)) {
    return null;
  }
  if (!source) return null;
  const canonical = /^https?:\/\//i.test(source) ? source.toLowerCase() : source.toLowerCase();
  const id = `SRC-${createHash("sha256").update(canonical).digest("hex").slice(0, 8).toUpperCase()}`;
  return {
    id,
    type,
    label,
    source,
    status: compact(row.status || "available", 100),
    ...(researchTopic ? { researchTopic } : {}),
    ...(queryId ? { queryId } : {}),
    rank: sourceRank(row),
  };
}

export function sanitizeAndDedupeSources(rows = []) {
  const bySource = new Map();
  for (const row of rows) {
    const safe = clientSafeSource(row);
    if (!safe) continue;
    const key = safe.source.toLowerCase();
    const current = bySource.get(key);
    if (!current || safe.rank > current.rank) bySource.set(key, safe);
  }
  return [...bySource.values()].map(({ rank, ...row }) => row).slice(0, 24);
}

export function isBlockedKpResearchContent(value = "") {
  return /(?:just a moment|access denied|captcha|verify you are human|enable javascript|robot emas|robot emasmisiz|avtomatik so['’]?rov|автоматическ(?:ий|ие) запрос|подтвердите, что вы не робот|cloudflare ray id)/i.test(String(value || ""));
}

export function buildUnknownMarketSizing(researchStatus = {}, sources = []) {
  const marketSizingSources = (sources || []).filter((item) => {
    const topic = String(item.researchTopic || item.topic || "").trim().toLowerCase();
    return /^(?:market_size|market_growth|market_forecast|market_volume)$/.test(topic);
  });
  return {
    status: "limited",
    tam: null,
    sam: null,
    som: null,
    formula: "Not calculated: reliable market sizing requires a confirmed geography, segment, period and source-backed denominator.",
    assumptions: [
      "No market number is presented as fact without claim-level evidence.",
      researchStatus.reason || "Research coverage is insufficient for a defensible TAM/SAM/SOM model.",
    ],
    sources: marketSizingSources.slice(0, 5),
  };
}

export function buildDurationAwareRoadmap({ durationMonths = 3, category = "Custom software product", scope = [], locale = "en" } = {}) {
  const duration = Math.max(1, Math.ceil(Number(durationMonths) || 1));
  const text = `${category} ${scope.join(" ")}`.toLowerCase();
  const food = /food|restaurant|courier|delivery/.test(text);
  const marketplace = /marketplace|seller|buyer|catalog/.test(text);
  const cashback = /cashback|loyalty|wallet|merchant/.test(text);
  const isUz = locale === "uz-Latn";
  const isRu = locale === "ru" || locale === "ru-RU";
  const periodLabel = (unit, value) => isUz ? `${value}-${unit === "week" ? "hafta" : "oy"}` : isRu ? `${unit === "week" ? "Неделя" : "Месяц"} ${value}` : `${unit === "week" ? "Week" : "Month"} ${value}`;
  if (duration === 1) {
    if (isUz) return [
      [periodLabel("week", 1), "Discovery va dizayn", "Talablar, arxitektura, asosiy jarayonlar va backlog", "PM, TL, Dizayner, BE"],
      [periodLabel("week", 2), "Asosiy ishlab chiqish", marketplace ? "Katalog, xaridor va sotuvchi uchun asosiy jarayonlar" : "Asosiy mahsulot va boshqaruv jarayonlari", "PM, TL, BE, FE/Mobil"],
      [periodLabel("week", 3), "Integratsiya va qabul", "Integratsiyalar, hisobotlar, QA va qabul tuzatishlari", "PM, BE, FE/Mobil, QA"],
      [periodLabel("week", 4), "Ishga tushirish", "Regression sinovi, production release, monitoring va topshirish", "PM, QA, DevOps"],
    ];
    if (isRu) return [
      [periodLabel("week", 1), "Discovery и дизайн", "Требования, архитектура, ключевые процессы и backlog", "PM, TL, Дизайнер, BE"],
      [periodLabel("week", 2), "Основная разработка", marketplace ? "Каталог и основные процессы покупателя и продавца" : "Основные продуктовые и административные процессы", "PM, TL, BE, FE/Mobile"],
      [periodLabel("week", 3), "Интеграции и приёмка", "Интеграции, отчёты, QA и исправления по приёмке", "PM, BE, FE/Mobile, QA"],
      [periodLabel("week", 4), "Запуск", "Регрессия, production release, мониторинг и передача", "PM, QA, DevOps"],
    ];
    return [["Week 1", "Discovery and design", "Requirements, architecture, core flows and backlog", "PM, TL, Designer, BE"], ["Week 2", "Core implementation", food ? "Customer, restaurant and courier core flows" : marketplace ? "Catalog, buyer and seller core flows" : "Primary product and admin flows", "PM, TL, BE, FE/Mobile"], ["Week 3", "Integrations and acceptance", "Integrations, reports, QA and client acceptance fixes", "PM, BE, FE/Mobile, QA"], ["Week 4", "Release", "Regression, production release, monitoring and handover", "PM, QA, DevOps"]];
  }
  let middleDeliverables = food
    ? [
        "Customer ordering, restaurant catalog and order acceptance",
        "Courier availability, assignment, tracking and delivery status",
        "Payments, promo rules, refunds and reconciliation",
        "Admin dispatch, support, analytics and operational integrations",
      ]
    : marketplace
      ? [
          "Catalog, categories, product cards and search",
          "Buyer cart, checkout and order lifecycle",
          "Seller onboarding, inventory and settlement operations",
          "Moderation, returns, analytics and integrations",
        ]
      : cashback
        ? [
            "Customer, merchant and offer flows",
            "Wallet, accrual and campaign rule engine",
            "Payment/bank integrations and reconciliation",
            "Fraud checks, analytics and support operations",
          ]
        : [
            "Core product and role-based user flows",
            "Admin workspace, business rules and reporting",
            "External integrations and data workflows",
            "Extended scope, acceptance fixes and operational tooling",
          ];
  if (isUz && marketplace) middleDeliverables = ["Katalog, toifalar, mahsulot kartalari va qidiruv", "Xaridor savati, checkout va buyurtma jarayoni", "Sotuvchini ulash, zaxira va hisob-kitob jarayonlari", "Moderatsiya, qaytarish, analitika va integratsiyalar"];
  if (isRu && marketplace) middleDeliverables = ["Каталог, категории, карточки товаров и поиск", "Корзина, checkout и жизненный цикл заказа", "Подключение продавца, остатки и расчёты", "Модерация, возвраты, аналитика и интеграции"];
  const rows = [];
  for (let month = 1; month <= duration; month += 1) {
    if (month === 1) {
      rows.push([periodLabel("month", month), isUz ? "Tahlil va asos yaratish" : isRu ? "Discovery и основа" : "Discovery and foundation", isUz ? "Talablar, arxitektura, UX/UI, backlog va ishlab chiqish muhiti" : isRu ? "Требования, архитектура, UX/UI, backlog и среда разработки" : "Requirements, architecture, UX/UI, backlog and development environment", isUz ? "PM, TL, Dizayner, BE, FE/Mobil, DevOps" : "PM, TL, Designer, BE, FE/Mobile, DevOps"]);
    } else if (month === duration) {
      rows.push([periodLabel("month", month), isUz ? "Mustahkamlash va ishga tushirish" : isRu ? "Стабилизация и запуск" : "Hardening and launch", isUz ? "UAT, regression, xavfsizlik va release tekshiruvlari, productionga chiqarish, o‘qitish va topshirish" : isRu ? "UAT, регрессия, проверки безопасности и release, production-запуск, обучение и передача" : "UAT, regression, security/release checks, production rollout, training and handover", isUz ? "PM, TL, BE, FE/Mobil, QA, DevOps" : "PM, TL, BE, FE/Mobile, QA, DevOps"]);
    } else {
      const progress = (month - 2) / Math.max(1, duration - 2);
      const index = Math.min(middleDeliverables.length - 1, Math.floor(progress * middleDeliverables.length));
      rows.push([periodLabel("month", month), isUz ? `Ishlab chiqish ${month - 1}` : isRu ? `Реализация ${month - 1}` : `Implementation ${month - 1}`, middleDeliverables[index], isUz ? "PM, TL, BE, FE/Mobil, QA" : "PM, TL, BE, FE/Mobile, QA"]);
    }
  }
  return rows;
}

function promptSourceId(sources = []) {
  return sources.find((item) => item.type === "client_brief")?.id || "SRC-PROMPT";
}

function offlineClaimLedger(brief = {}, sources = []) {
  const sourceId = promptSourceId(sources);
  const locale = brief.sourceLanguage || "en";
  const words = locale === "uz-Latn"
    ? { project: "Loyiha nomi", analog: "Mahsulot analogi", budget: "Budjet", currencyUnknown: "valyuta ko‘rsatilmagan", timeline: "Yetkazib berish muddati", months: "oy", requested: "So‘ralgan scope", detected: "Aniqlangan mahsulot signali" }
    : locale === "ru"
      ? { project: "Название проекта", analog: "Продуктовый аналог", budget: "Бюджет", currencyUnknown: "валюта не указана", timeline: "Срок реализации", months: "месяцев", requested: "Запрошенный scope", detected: "Определённый сигнал продукта" }
      : { project: "Project name", analog: "Product analog", budget: "Budget", currencyUnknown: "currency not specified", timeline: "Delivery timeline", months: "months", requested: "Requested scope", detected: "Detected product signal" };
  const rows = [];
  const add = (claim, kind = "input", status = "explicit", evidenceExcerpt = "") => {
    if (!claim) return;
    rows.push({
      id: `CLM-${String(rows.length + 1).padStart(3, "0")}`,
      claim: compact(claim, 280),
      kind,
      status,
      sourceIds: [sourceId],
      evidenceExcerpt: compact(evidenceExcerpt, 300),
    });
  };
  const quoteOf = (field = {}) => field.evidenceRefs?.[0]?.quote || String(field.value || "");
  if (brief.projectName?.value) add(`${words.project}: ${brief.projectName.value}`, "input", "explicit", quoteOf(brief.projectName));
  if (brief.analog?.name?.value) add(`${words.analog}: ${brief.analog.name.value}`, "input", "explicit", quoteOf(brief.analog.name));
  if (brief.budget?.amount?.value) add(`${words.budget}: ${brief.budget.amount.value} ${brief.budget.currency?.value || words.currencyUnknown}`, "input", brief.budget.currency?.status || "explicit", quoteOf(brief.budget.amount));
  if (brief.timeline?.months?.value) add(`${words.timeline}: ${brief.timeline.months.value} ${words.months}`, "input", "explicit", quoteOf(brief.timeline.months));
  for (const item of (brief.scope || []).slice(0, 12)) {
    const requested = item.status === "explicit" || item.inclusion === "requested";
    add(
      `${requested ? words.requested : words.detected}: ${item.value}`,
      "input",
      requested ? "explicit" : item.status || "inferred",
      quoteOf(item),
    );
  }
  return rows;
}

export function buildGuardedNarrative(brief = {}, project = {}, claimLedger = []) {
  const title = brief.projectName?.value || brief.workingTitle?.value || project.title || "Software product";
  const category = brief.productCategory?.value || project.type || "software product";
  const locale = brief.sourceLanguage || "en";
  const explicitScope = (brief.scope || [])
    .filter((item) => item.status === "explicit" || item.inclusion === "requested")
    .map((item) => item.value)
    .filter(Boolean);
  const analog = brief.analog?.name?.value;
  const amount = Number(brief.budget?.amount?.value || 0);
  const currency = brief.budget?.currency?.value;
  const currencyStatus = brief.budget?.currency?.status || "unknown";
  const months = Number(brief.timeline?.months?.value || project.duration_months || 0);
  const geographyKnown = Boolean(brief.geography?.value);
  const paymentScheduleRequested = (brief.requestedSections || []).includes("payments");
  const researchSignal = claimLedger.find((claim) => claim.kind === "research" && ["verified", "single_source"].includes(claim.status) && claim.sourceIds?.length);
  const formattedAmount = amount ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount) : "";

  if (locale === "uz-Latn") {
    const categoryLabel = /food delivery/i.test(category)
      ? "ovqat yetkazib berish xizmati"
      : /marketplace/i.test(category)
        ? "marketpleys"
        : /crm/i.test(category)
          ? "CRM tizimi"
          : "raqamli mahsulot";
    const commercialFacts = [
      months ? `Mijoz yetkazib berish muddatini aniq ${months} oy deb belgilagan.` : "Yetkazib berish muddati hali aniqlashtiriladi.",
      amount
        ? currencyStatus === "explicit"
          ? `Tasdiqlash uchun ishchi budjet: ${currency} ${formattedAmount}.`
          : currencyStatus === "assumed"
            ? `Mijoz ${formattedAmount} miqdorini ko‘rsatgan; ${currency} valyutasi faqat ishchi taxmin bo‘lib, tasdiqlanishi kerak.`
            : `Mijoz budjet miqdorini ${formattedAmount} deb ko‘rsatgan, ammo valyutani ko‘rsatmagan; tijorat tasdig‘idan oldin valyuta aniqlashtiriladi.`
        : "Ishchi budjet hali aniqlashtiriladi.",
    ];
    const categoryFrame = /food delivery/i.test(category)
      ? "Asosiy mahsulot qarori — buyurtma, restoran operatsiyasi, kuryer yetkazib berishi, to‘lov va yordam jarayonlarini bitta kuzatiladigan zanjirga birlashtirish."
      : /marketplace/i.test(category)
        ? "Asosiy mahsulot qarori — marketpleysning operatsion modeli: ishtirokchi rollari, katalog boshqaruvi, savat va buyurtmani rasmiylashtirish, bajarish chegaralari, moderatsiya, qaytarish va hisob-kitob qoidalari."
        : "Asosiy mahsulot qarori — MVPni belgilaydigan foydalanuvchi rollari, jarayonlar, integratsiyalar, ma’lumot chegaralari va qabul mezonlari.";
    const scopeStatement = explicitScope.length
      ? `Mijoz aniq so‘ragan tarkib: ${explicitScope.slice(0, 8).join(", ")}.`
      : "Funksiyalar tarkibi mijoz tomonidan tasdiqlanmagan; hujjatdagi imkoniyatlar xaritasi talablarni aniqlash uchun tavsiya bo‘lib, yetkazib berish majburiyati emas.";
    const benchmarkStatement = analog
      ? `${analog} faqat mahsulotni taqqoslash namunasi sifatida ishlatiladi; uning funksiyalari va operatsion modeli avtomatik ravishda tasdiqlangan tarkibga kirmaydi.`
      : "Mahsulot analogi tasdiqlanmagan.";
    const geographyStatement = geographyKnown
      ? `Maqsadli geografiya: ${brief.geography.value}.`
      : "Maqsadli geografiya tasdiqlanmagan; mamlakatga oid tadqiqot faqat taqqoslash uchun ishlatiladi.";
    const evidenceStatement = researchSignal
      ? researchSignal.status === "verified"
        ? "Analog bo‘yicha bir nechta o‘qiladigan manbada tasdiqlangan signal bor; u tavsiya etilgan tarkib emas, faqat taqqoslash dalilidir."
        : "Analog bo‘yicha bitta o‘qiladigan manbaga tayangan signal bor; u alohida tekshirilishi kerak va tasdiqlangan tarkib hisoblanmaydi."
      : "O‘qiladigan manba bilan tasdiqlanmagan tashqi da’vo taklifga fakt sifatida kiritilmaydi.";
    return {
      executiveSummary: `${title} ${categoryLabel} sifatida shakllantirilmoqda. ${commercialFacts.join(" ")} ${benchmarkStatement} ${geographyStatement}`,
      problemStatement: `${categoryFrame} ${scopeStatement} ${evidenceStatement}`,
      solutionNarrative: `Avval rollar, boshlang‘ich mahsulot chegaralari, integratsiyalar va qabul mezonlari kelishiladi. ${scopeStatement} Yo‘l xaritasi, jamoa va funksional taqsimot asosiy qarorlar tasdiqlanmaguncha rejalashtirish taxmini bo‘lib qoladi.${paymentScheduleRequested ? " To‘lov jadvali ham alohida tasdiqlanadi." : ""}`,
      whyNow: "Budjet miqdori va muddat ma’lum, ammo tarkib, valyuta va operatsion qoidalar tasdiqlanmagan; shu qarorlarni bir joyda yopish rejalashtirish xatosini kamaytiradi.",
      deliveryApproach: "Talablarni aniqlashdan boshlash, tavsiya etilgan boshlang‘ich mahsulotni tasdiqlash, ishlarni qabul mezonlariga bog‘lash va har bir bosqichni namoyish bilan tekshirish.",
      closingStatement: "Keyingi qadam: barcha ochiq tijorat shartlari va mijozga bog‘liq talablarni mas’ullar bilan yopish, so‘ng narx va ish boshlash bazasini alohida tasdiqlash.",
      differentiators: [
        "Mijoz so‘ragan imkoniyatlar va taqqoslash asosidagi tavsiyalar aniq ajratiladi.",
        "Har bir bozor yoki analog da’vosi o‘qiladigan manba bilan bog‘lanadi.",
        "Manbasiz TAM, SAM va SOM qiymatlari o‘ylab topilmaydi.",
        paymentScheduleRequested
          ? "Funksional taqsimot, jamoa rejasi, umumiy summa va to‘lov ssenariysi arifmetik jihatdan moslashtiriladi."
          : "Funksional taqsimot, jamoa rejasi va umumiy summa o‘zaro moslashtiriladi.",
      ],
    };
  }

  if (locale === "ru") {
    const categoryLabel = /food delivery/i.test(category)
      ? "сервис доставки еды"
      : /marketplace/i.test(category)
        ? "маркетплейс"
        : /crm/i.test(category)
          ? "CRM-система"
          : "цифровой продукт";
    const commercialFacts = [
      months ? `Клиент явно указал срок реализации ${months} мес.` : "Срок реализации нужно уточнить.",
      amount
        ? currencyStatus === "explicit"
          ? `Рабочий бюджет для согласования: ${currency} ${formattedAmount}.`
          : currencyStatus === "assumed"
            ? `Клиент указал сумму ${formattedAmount}; валюта ${currency} является рабочим допущением и требует подтверждения.`
            : `Клиент указал сумму бюджета ${formattedAmount}, но не указал валюту; валюту необходимо подтвердить до коммерческого согласования.`
        : "Рабочий бюджет нужно уточнить.",
    ];
    const categoryFrame = /food delivery/i.test(category)
      ? "Ключевое продуктовое решение — связать заказ клиента, операции ресторана, курьерское исполнение, оплату и поддержку в один отслеживаемый процесс."
      : /marketplace/i.test(category)
        ? "Ключевое продуктовое решение — операционная модель маркетплейса: роли участников, управление каталогом, корзина и оформление заказа, границы исполнения, модерация, возвраты и расчёты."
        : "Ключевое продуктовое решение — роли, процессы, интеграции, границы данных и критерии приёмки, определяющие MVP.";
    const scopeStatement = explicitScope.length
      ? `Явно запрошенный клиентом состав: ${explicitScope.slice(0, 8).join(", ")}.`
      : "Функциональный состав не был явно подтверждён клиентом; карта возможностей в предложении является рекомендацией для предпроектного анализа, а не обязательством по поставке.";
    const benchmarkStatement = analog
      ? `${analog} используется только как продуктовый аналог; его функции и операционная модель автоматически не входят в подтверждённый состав.`
      : "Продуктовый аналог не подтверждён.";
    const geographyStatement = geographyKnown ? `Целевая география: ${brief.geography.value}.` : "Целевая география не подтверждена; страновые исследования используются только для сравнения.";
    const evidenceStatement = researchSignal
      ? researchSignal.status === "verified"
        ? "Сигнал по аналогу подтверждён несколькими читаемыми источниками; это основание для сравнения, а не согласованный состав."
        : "Сигнал по аналогу основан на одном читаемом источнике, требует отдельной проверки и не является согласованным составом."
      : "Внешние утверждения без читаемого источника не выдаются в предложении за факты.";
    return {
      executiveSummary: `${title} формируется как ${categoryLabel}. ${commercialFacts.join(" ")} ${benchmarkStatement} ${geographyStatement}`,
      problemStatement: `${categoryFrame} ${scopeStatement} ${evidenceStatement}`,
      solutionNarrative: `Сначала согласовываются роли, границы первого выпуска, интеграции и критерии приёмки. ${scopeStatement} Дорожная карта, команда и функциональное распределение остаются плановым сценарием до согласования базовых решений.${paymentScheduleRequested ? " График оплаты согласовывается отдельно." : ""}`,
      whyNow: "Сумма бюджета и срок известны, но состав, валюта и операционные правила не согласованы; фиксация этих решений снижает риск ошибки планирования.",
      deliveryApproach: "Начать с предпроектного анализа, согласовать рекомендуемый первый выпуск, связать работы с критериями приёмки и проверять каждый этап через демонстрацию.",
      closingStatement: "Следующий шаг: закрыть с ответственными все открытые коммерческие условия и клиентские зависимости, затем отдельно согласовать цену и исходные условия старта.",
      differentiators: [
        "Запрошенные клиентом возможности и рекомендации по аналогу явно разделены.",
        "Каждое рыночное утверждение или факт об аналоге связано с читаемым источником.",
        "Неподтверждённые значения TAM, SAM и SOM не выдумываются.",
        paymentScheduleRequested
          ? "Функциональное распределение, команда, итоговая сумма и сценарий оплаты согласованы арифметически."
          : "Функциональное распределение, команда и итоговая сумма согласованы арифметически.",
      ],
    };
  }

  const commercialFacts = [
    months ? `The client explicitly set a ${months}-month delivery target.` : "The delivery target remains to be confirmed.",
    amount
      ? currencyStatus === "explicit"
        ? `The working budget for confirmation is ${currency} ${formattedAmount}.`
        : currencyStatus === "assumed"
          ? `The client stated a ${formattedAmount} budget; ${currency} is a working assumption pending confirmation.`
          : `The client stated a budget amount of ${formattedAmount}, but no currency; currency must be confirmed before commercial acceptance.`
      : "The working budget remains to be confirmed.",
  ];
  const categoryFrame = /food delivery/i.test(category)
    ? "The central product decision is how customer ordering, restaurant operations, courier fulfilment, payments, and support hand off across one traceable journey."
    : /marketplace/i.test(category)
      ? "The central product decision is the marketplace operating model: participant roles, catalog governance, checkout, fulfilment boundaries, moderation, returns, and settlement rules."
      : /crm/i.test(category)
        ? "The central product decision is how lead ownership, pipeline stages, client history, automation, and management reporting operate as one controlled workflow."
        : "The central product decision is which user roles, workflows, integrations, data boundaries, and acceptance rules define the MVP.";
  const scopeStatement = explicitScope.length
    ? `Committed client scope: ${explicitScope.slice(0, 8).join(", ")}.`
    : "No feature-level scope was explicitly confirmed; the capability map in this proposal is a recommendation for discovery, not a delivery commitment.";
  const benchmarkStatement = analog
    ? `${analog} is used as a product benchmark only; its features and operating model do not enter committed scope automatically.`
    : "No product analog was confirmed.";
  const geographyStatement = geographyKnown
    ? `Target geography: ${brief.geography.value}.`
    : "Target geography is not confirmed; country-specific research is benchmark context only.";
  const evidenceStatement = researchSignal
    ? researchSignal.status === "verified"
      ? `Corroborated benchmark signal: ${researchSignal.claim} This describes the cited market or analog, not the proposed product scope.`
      : `Single-source benchmark signal requiring validation: ${researchSignal.claim} This is not committed product scope.`
    : "No external benchmark claim is promoted into the proposal without readable source evidence.";

  return {
    executiveSummary: `${title} is being shaped as a ${String(category).toLowerCase()}. ${commercialFacts.join(" ")} ${benchmarkStatement} ${geographyStatement}`,
    problemStatement: `${categoryFrame} ${scopeStatement} ${evidenceStatement}`,
    solutionNarrative: `Begin with a decision-focused discovery to confirm roles, MVP boundaries, non-functional requirements, integrations, and acceptance criteria. ${scopeStatement} The roadmap, team, functional allocation, and payment stages remain planning scenarios until that baseline is approved.`,
    whyNow: "The budget amount and timeline are known, while scope, currency, and operating rules remain unresolved; closing those decisions now reduces planning risk.",
    deliveryApproach: "Start with discovery, approve the recommended MVP, tie work to acceptance criteria, and validate each stage through a demo.",
    closingStatement: "Next, close every open commercial term and client dependency with its owner, then approve the price and kickoff baseline separately.",
    differentiators: [
      "Client-requested capabilities and benchmark recommendations are separated visibly.",
      "Every promoted market or analog fact is tied to a readable source in the claim ledger.",
      "Unsupported TAM, SAM, and SOM values remain uncalculated instead of being fabricated.",
      "Functional allocation, team plan, project total, and payment scenario reconcile arithmetically.",
    ],
  };
}

function offlineNarrative(brief = {}, project = {}, sources = [], reason = "LLM synthesis disabled") {
  const claimLedger = offlineClaimLedger(brief, sources);
  return {
    schemaVersion: KP_CONTENT_SCHEMA_VERSION,
    mode: "offline",
    status: "grounded_fallback",
    reason,
    ...buildGuardedNarrative(brief, project, claimLedger),
    claimLedger,
    rejectedClaimCount: 0,
  };
}

function parseJsonObject(value = "") {
  const clean = String(value || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM did not return a JSON object");
  return JSON.parse(clean.slice(start, end + 1));
}

function normalizedEvidence(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-zа-яё0-9$%]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceTokens(value = "") {
  return [...new Set(normalizedEvidence(value).split(" ").filter((token) => token.length >= 3))];
}

function excerptSupported(excerpt = "", corpus = "") {
  const normalizedExcerpt = normalizedEvidence(excerpt);
  const normalizedCorpus = normalizedEvidence(corpus);
  if (!normalizedExcerpt || !normalizedCorpus) return false;
  if (normalizedCorpus.includes(normalizedExcerpt)) return true;
  const tokens = evidenceTokens(normalizedExcerpt);
  if (!tokens.length) return false;
  const corpusTokens = new Set(evidenceTokens(normalizedCorpus));
  const matched = tokens.filter((token) => corpusTokens.has(token)).length;
  return matched / tokens.length >= 0.72 && matched >= Math.min(3, tokens.length);
}

function briefEvidenceText(brief = {}) {
  const rows = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.value !== undefined && value.value !== null) rows.push(String(value.value));
    if (Array.isArray(value.evidenceRefs)) rows.push(...value.evidenceRefs.map((item) => item.quote || ""));
    Object.values(value).forEach(visit);
  };
  visit(brief);
  return rows.filter(Boolean).join(" ");
}

export function normalizeBriefClaimSemantics(claims = [], brief = {}, promptId = "", sources = []) {
  const currencyStatus = brief.budget?.currency?.status || "unknown";
  const budgetAmount = Number(brief.budget?.amount?.value || 0);
  const locale = brief.sourceLanguage || "en";
  const scopeEntries = (brief.scope || []).map((item) => ({
    value: String(item.value || "").toLowerCase(),
    status: String(item.status || "").toLowerCase(),
    inclusion: String(item.inclusion || "").toLowerCase(),
  })).filter((item) => item.value);
  const sourceById = new Map((sources || []).map((source) => [source.id, source]));
  return claims.map((claim) => {
    const externalSourceCount = (claim.sourceIds || []).filter((id) => id !== promptId).length;
    const independentExternalSourceCount = new Set((claim.sourceIds || [])
      .filter((id) => id !== promptId)
      .map((id) => sourceOriginKey(sourceById.get(id), id))
      .filter(Boolean)).size;
    const citesPrompt = Boolean(promptId && claim.sourceIds?.includes(promptId));
    const text = String(claim.claim || "").toLowerCase();
    if (citesPrompt && /budget|investment|budjet|byudjet|бюджет/.test(text)) {
      if (currencyStatus === "unknown") {
        const amount = budgetAmount ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(budgetAmount) : "";
        const safeClaim = locale === "uz-Latn"
          ? `Mijoz budjet miqdorini ${amount} deb ko‘rsatgan; valyuta ko‘rsatilmagan.`
          : locale === "ru"
            ? `Клиент указал сумму бюджета ${amount}; валюта не указана.`
            : `The client stated a budget amount of ${amount}; currency was not specified.`;
        return { ...claim, claim: safeClaim, kind: "input", status: "explicit" };
      }
      return { ...claim, kind: "input", status: currencyStatus === "assumed" ? "assumed" : "explicit" };
    }
    if (citesPrompt && /timeline|duration|month|oy|месяц/.test(text)) return { ...claim, kind: "input", status: "explicit" };
    if (citesPrompt && /analog|similar|o['’]?xsh|uxsh|benchmark/.test(text)) {
      return externalSourceCount
        ? { ...claim, kind: "mixed", status: "single_source" }
        : { ...claim, kind: "input", status: "explicit" };
    }
    const matchingScopeEntries = citesPrompt ? scopeEntries.filter((item) => text.includes(item.value)) : [];
    if (matchingScopeEntries.length) {
      const allRequested = matchingScopeEntries.every((item) => item.status === "explicit" || item.inclusion === "requested");
      if (!allRequested) {
        return {
          ...claim,
          kind: "recommendation",
          status: claim.status === "inferred" ? "inferred" : "recommended",
        };
      }
      return { ...claim, kind: "input", status: "single_source" };
    }
    if (claim.kind === "research" && /(?:\b(?:the|our|proposed)\s+(?:project|platform|solution|product)\s+(?:should|must|needs? to)\b|\bwe\s+recommend\b)/.test(text)) {
      return { ...claim, kind: "recommendation", status: "recommended" };
    }
    if (claim.kind === "research") return { ...claim, status: independentExternalSourceCount > 1 ? "verified" : "single_source" };
    if (citesPrompt) return { ...claim, kind: "input", status: claim.status || "single_source" };
    return claim;
  });
}

export function validateGroundedNarrativePayload(payload = {}, validSourceIds = new Set(), evidenceBySource = new Map()) {
  const required = ["executiveSummary", "problemStatement", "solutionNarrative"];
  for (const key of required) {
    if (typeof payload[key] !== "string" || !payload[key].trim() || payload[key].length > 1200) throw new Error(`Invalid narrative field: ${key}`);
  }
  const differentiators = Array.isArray(payload.differentiators) ? payload.differentiators.map((item) => compact(item, 260)).filter(Boolean).slice(0, 6) : [];
  let rejectedClaimCount = 0;
  const claimLedger = Array.isArray(payload.claimLedger) ? payload.claimLedger.slice(0, 24).map((item, index) => {
    if (!item || typeof item.claim !== "string" || !item.claim.trim()) {
      rejectedClaimCount += 1;
      return null;
    }
    let sourceIds = Array.isArray(item.sourceIds) ? item.sourceIds.filter((id) => validSourceIds.has(id)) : [];
    if (!sourceIds.length) {
      rejectedClaimCount += 1;
      return null;
    }
    const kind = /^(?:input|research|assumption|recommendation)$/.test(item.kind) ? item.kind : "research";
    const evidenceExcerpt = compact(item.evidenceExcerpt || item.evidenceQuote || "", 320);
    if (/^(?:input|research)$/.test(kind)) {
      const supportingSourceIds = evidenceExcerpt
        ? sourceIds.filter((id) => excerptSupported(evidenceExcerpt, evidenceBySource.get(id) || ""))
        : [];
      if (!supportingSourceIds.length) {
        rejectedClaimCount += 1;
        return null;
      }
      // Persist only sources that actually contain the cited excerpt. Merely
      // listing two URLs must never upgrade a prompt claim to “verified”.
      sourceIds = supportingSourceIds;
    }
    if (kind === "research" && assertsSellerManagement(item.claim)) {
      const directEvidenceSourceIds = hasDirectSellerManagementEvidence(evidenceExcerpt)
        ? sourceIds.filter((id) => hasDirectSellerManagementEvidence(evidenceBySource.get(id) || ""))
        : [];
      if (!directEvidenceSourceIds.length) {
        rejectedClaimCount += 1;
        return null;
      }
      sourceIds = directEvidenceSourceIds;
    }
    if (kind === "research" && unsupportedResearchQualifier(item.claim, evidenceExcerpt)) {
      rejectedClaimCount += 1;
      return null;
    }
    if (kind === "research" && !quantitativeSignaturePreserved(item.claim, evidenceExcerpt)) {
      rejectedClaimCount += 1;
      return null;
    }
    return {
      id: `CLM-${String(index + 1).padStart(3, "0")}`,
      claim: compact(item.claim, 320),
      kind,
      status: /^(?:explicit|verified|single_source|assumed|recommended)$/.test(item.status) ? item.status : "single_source",
      sourceIds,
      evidenceExcerpt,
      claimNature: normalizeClaimNature(item.claimNature) || inferClaimNature(`${item.claim} ${evidenceExcerpt}`),
    };
  }).filter(Boolean) : [];
  return {
    executiveSummary: compact(payload.executiveSummary, 1200),
    problemStatement: compact(payload.problemStatement, 1200),
    solutionNarrative: compact(payload.solutionNarrative, 1200),
    differentiators,
    claimLedger,
    rejectedClaimCount,
  };
}

function unsupportedResearchQualifier(claim = "", evidenceExcerpt = "") {
  const candidate = String(claim || "").normalize("NFKC").toLowerCase();
  const evidence = String(evidenceExcerpt || "").normalize("NFKC").toLowerCase();
  const qualifierFamilies = [
    /(?:\ball\b|\bevery\b|\bcomplete\b|\bfull(?:y)?\b|\bbarcha\b|\bhamma\b|\bto['’ʻ]?liq\b|\bвсе\b|\bвесь\b|\bполный\b|\bполностью\b)/iu,
    /(?:\b(?:necessary|required|essential|mandatory|must)\b|\bzarur\b|\bmajburiy\b|\bkerak\b|необходим\p{L}*|обязател\p{L}*)/iu,
    /(?:\b(?:largest|leading|best|fastest|only)\b|\beng\s+(?:katta|yirik|yaxshi|tez)\b|крупнейш\p{L}*|ведущ\p{L}*|лучш\p{L}*)/iu,
  ];
  return qualifierFamilies.some((pattern) => pattern.test(candidate) && !pattern.test(evidence));
}

function quantitativeSignaturePreserved(claim = "", evidenceExcerpt = "") {
  const evidence = quantitativeSignature(evidenceExcerpt);
  if (!evidence.size) return true;
  const candidate = quantitativeSignature(claim);
  return [...evidence].every((token) => candidate.has(token));
}

function quantitativeSignature(value = "") {
  const text = String(value || "").normalize("NFKC").toLowerCase();
  const tokens = new Set();
  const currencyPatterns = [
    [/(?:\busd\b|us\$|\$)/giu, "currency:USD"],
    [/(?:\beur\b|€)/giu, "currency:EUR"],
    [/(?:\buzs\b|so['’ʻ]?m|сум)/giu, "currency:UZS"],
    [/(?:\bgbp\b|£)/giu, "currency:GBP"],
  ];
  for (const [pattern, token] of currencyPatterns) if (pattern.test(text)) tokens.add(token);
  const scalePatterns = [
    [/(?:\bbillion\b|\bbn\b|milliard|milliard|миллиард|млрд)/giu, "scale:billion"],
    [/(?:\bmillion\b|\bmn\b|\bmln\b|million|миллион|млн)/giu, "scale:million"],
    [/(?:\btrillion\b|\btn\b|trillion|триллион|трлн)/giu, "scale:trillion"],
    [/(?:percent|percentage|foiz|процент|%)/giu, "unit:percent"],
  ];
  for (const [pattern, token] of scalePatterns) if (pattern.test(text)) tokens.add(token);
  for (const match of text.matchAll(/\b\d+(?:[.,]\d+)*(?:\s?%)?/gu)) {
    const raw = match[0].replace(/\s/g, "").replace(/%$/, "");
    const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw);
    const normalized = grouped ? raw.replace(/[.,]/g, "") : raw.replace(/,/g, ".");
    tokens.add(`number:${normalized}`);
  }
  return tokens;
}

function normalizeClaimNature(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["observed", "reported", "estimate", "forecast", "scenario"].includes(normalized) ? normalized : "";
}

function inferClaimNature(value = "") {
  const text = String(value || "").toLowerCase();
  if (/scenario|сценар|ssenari/iu.test(text)) return "scenario";
  if (/forecast|project(?:ed|ion)|прогноз|prognoz|kutil(?:moqda|adi)|ожида(?:ется|емый)/iu.test(text)) return "forecast";
  if (/estimate|estimated|approximately|taxmin|оценк|примерно|около/iu.test(text)) return "estimate";
  if (/report(?:ed|s)?|according|сообща|по данным|ma['’]?lumot/iu.test(text)) return "reported";
  return "observed";
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`KP grounded synthesis timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeGroundedNarrative({ brief = {}, project = {}, sources = [], evidenceSnippets = [] } = {}, options = {}) {
  const provider = options.provider
    || process.env.KP_SYNTHESIS_PROVIDER
    || (process.env.OPENAI_API_KEY ? "openai" : process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.LLM_PROVIDER || "openai");
  const model = options.model || process.env.KP_SYNTHESIS_MODEL || (provider === "anthropic" ? process.env.CLAUDE_MODEL || "claude-sonnet-4-5" : process.env.OPENAI_MODEL || "gpt-4.1-mini");
  const hasKey = provider === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : Boolean(process.env.OPENAI_API_KEY);
  const enabledSetting = String(process.env.KP_ENABLE_LLM_SYNTHESIS || "auto");
  const enabled = options.enabled ?? (/^(?:0|false|no|off)$/i.test(enabledSetting)
    ? false
    : /^(?:1|true|yes|on)$/i.test(enabledSetting)
      ? true
      : hasKey);
  const fallback = {
    ...offlineNarrative(brief, project, sources, enabled ? "Grounded LLM synthesis unavailable" : "Grounded LLM synthesis disabled"),
    provider: enabled ? provider : "offline",
    model: enabled ? model : "",
  };
  if (!enabled) return fallback;
  if (!hasKey) return { ...fallback, reason: `${provider} API key is unavailable` };
  const timeoutMs = Math.max(2_000, Number(options.timeoutMs || process.env.KP_SYNTHESIS_TIMEOUT_MS || 20_000));
  const validSourceIds = new Set(sources.map((item) => item.id).filter(Boolean));
  const sourceId = promptSourceId(sources);
  validSourceIds.add(sourceId);
  const briefForPrompt = JSON.parse(JSON.stringify(brief).replaceAll("SRC-PROMPT", sourceId));
  const evidenceBySource = new Map([[sourceId, briefEvidenceText(briefForPrompt)]]);
  for (const item of evidenceSnippets) {
    if (!validSourceIds.has(item.sourceId) || !item.text) continue;
    evidenceBySource.set(item.sourceId, `${evidenceBySource.get(item.sourceId) || ""} ${compact(item.text, 2400)}`.trim());
  }
  const payload = {
    brief: briefForPrompt,
    sources: sources.map((item) => ({ id: item.id, type: item.type, label: item.label, status: item.status })),
    evidenceSnippets: evidenceSnippets.slice(0, 12).map((item) => ({ sourceId: item.sourceId, text: compact(item.text, 900) })).filter((item) => validSourceIds.has(item.sourceId) && item.text),
    lockedCommercials: {
      projectPrice: briefForPrompt.budget?.currency?.status === "explicit" ? Number(project.budget_usd) || 0 : null,
      budgetAmount: Number(briefForPrompt.budget?.amount?.value) || null,
      currency: briefForPrompt.budget?.currency?.value || null,
      currencyStatus: briefForPrompt.budget?.currency?.status || "unknown",
      durationMonths: Number(project.duration_months) || null,
      scopeCount: Number(project.scope_count) || null,
    },
  };
  const system = [
    "You are a senior software proposal consultant.",
    "Return one JSON object only with executiveSummary, problemStatement, solutionNarrative, differentiators[], claimLedger[].",
    "Use only the supplied brief and evidence snippets. Never invent facts, market sizes, customer counts, prices, rates or percentages.",
    "Never change or recalculate lockedCommercials. Do not output pricing/payment/team fields.",
    "Every claimLedger item must contain claim, kind, status and sourceIds from the supplied source list.",
    "Input and research claims must also contain evidenceExcerpt copied closely from the cited brief quote or evidence snippet; unsupported claims will be discarded.",
    "Recommendations and assumptions are allowed only when kind and status label them explicitly; do not present them as verified research.",
    "Separate explicit client scope from recommendations. Missing information must remain unknown.",
    "A brief scope item is committed only when its status is explicit or its inclusion is requested. Inferred/detected items describe the product category only and must stay recommended until confirmed.",
    "Never convert an analog feature or research fact into committed solution scope. If it was not explicitly requested, describe it only as an optional benchmark recommendation.",
    "The solutionNarrative may commit only explicit client scope; one-day delivery, logistics, fintech, banking, regulatory workflows, and other analog capabilities must stay optional unless the brief explicitly requests them.",
    "If a currency is marked assumed in the brief, any budget claim must also be an input assumption, never verified research.",
    "If the client budget currency is unknown, preserve the numeric budget amount but never name, infer, or display USD or another currency for the budget or proposal price; say that the commercial currency must be confirmed. If a budget currency is assumed, commercial prose must say it is a working assumption pending confirmation.",
    "For external research claims, preserve every cited number, currency, unit, percentage, period and year exactly from evidenceExcerpt. A research currency such as USD is evidence context only and must never be transferred to the client budget.",
    "Two URLs on the same registrable domain are one publisher, not independent confirmation. Never call first-party marketing copy verified merely because it appears on two pages of the same site.",
    "Do not strengthen evidence with words such as all necessary, required, complete, leading, largest, best, only, or guaranteed unless the copied evidence excerpt states that exact qualification.",
    "If geography is unknown, never claim the product targets, serves, or is tailored for a specific country; geographic research is benchmark context only and the target geography must remain to be confirmed.",
    `Write every narrative field and every claim text in ${briefForPrompt.sourceLanguage === "uz-Latn" ? "Uzbek (Latin script)" : briefForPrompt.sourceLanguage === "ru" ? "Russian" : "English"}. This is mandatory, not optional. Preserve proper names and source quotes as needed.`,
    "Keep language professional and concise.",
  ].join(" ");
  try {
    let raw = "";
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const request = client.messages.create({
        model,
        max_tokens: 1800,
        temperature: 0,
        system,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      });
      const result = await withTimeout(request, timeoutMs);
      raw = result.content?.find((item) => item.type === "text")?.text || "";
    } else {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const request = client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }],
      });
      const result = await withTimeout(request, timeoutMs);
      raw = result.choices?.[0]?.message?.content || "";
    }
    const validated = validateGroundedNarrativePayload(parseJsonObject(raw), validSourceIds, evidenceBySource);
    validated.claimLedger = normalizeBriefClaimSemantics(validated.claimLedger, briefForPrompt, sourceId, sources);
    const guardedNarrative = buildGuardedNarrative(briefForPrompt, project, validated.claimLedger);
    return {
      schemaVersion: KP_CONTENT_SCHEMA_VERSION,
      mode: "llm_guarded",
      status: "grounded",
      reason: "One validated synthesis call completed; deterministic claim guards composed the final prose.",
      provider,
      model,
      ...validated,
      ...guardedNarrative,
    };
  } catch (error) {
    return { ...fallback, reason: compact(error.message, 300) || "Grounded synthesis failed validation" };
  }
}
