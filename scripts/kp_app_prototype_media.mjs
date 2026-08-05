export const APP_PROTOTYPE_MEDIA_VERSION = "app-prototype-media-v2";

const UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos";
const UNSPLASH_IMAGE_HOST = "images.unsplash.com";
const MEDIA_LIMIT = 12;

const CURATED_PHOTO_IDS = Object.freeze({
  "real-estate": [
    "1600585154340-be6161a56a0c",
    "1600607687939-ce8a6c25118c",
    "1564013799919-ab600027ffc6",
    "1600566753190-17f0baa2a6c3",
    "1600573472550-8090b5e0745e",
    "1600607688969-a5bfcd646154",
    "1600607687920-4e2a09cf159d",
    "1600585154526-990dced4db0d",
  ],
  commerce: [
    "1441986300917-64674bd600d8",
    "1523275335684-37898b6baf30",
    "1542291026-7eec264c27ff",
    "1472851294608-062f824d29cc",
    "1555529669-e69e7aa0ba9a",
    "1607082349566-187342175e2f",
    "1495474472287-4d71bcdd2085",
    "1598033129183-c4f50c736f10",
  ],
  logistics: [
    "1586528116311-ad8dd3c8310d",
    "1566576912321-d58ddd7a6088",
    "1553413077-190dd305871c",
    "1494412574643-ff11b0a5c1c3",
    "1580674285054-bed31e145f59",
    "1578575437130-527eed3abbec",
    "1587293852726-70cdb56c2866",
    "1601584115197-04ecc0da31d7",
  ],
  healthcare: [
    "1576091160399-112ba8d25d1d",
    "1584982751601-97dcc096659c",
    "1538108149393-fbbd81895907",
    "1551076805-e1869033e561",
    "1516841273335-e39b37888115",
    "1584515933487-779824d29309",
    "1532938911079-1b06ac7ceec7",
    "1519494026892-80bbd2d6fd0d",
  ],
  food: [
    "1504674900247-0877df9cc836",
    "1565299624946-b28f40a0ae38",
    "1547592180-85f173990554",
    "1515003197210-e0cd71810b5f",
    "1473093295043-cdd812d0e601",
    "1414235077428-338989a2e8c0",
    "1546069901-ba9599a7e63c",
    "1552566626-52f8b828add9",
  ],
  education: [
    "1523240795612-9a054b0db644",
    "1509062522246-3755977927d7",
    "1497633762265-9d179a990aa6",
    "1522202176988-66273c2fd55f",
    "1516321318423-f06f85e504b3",
    "1524178232363-1fb2b075b655",
    "1503676260728-1c00da094a0b",
    "1532012197267-da84d127e765",
  ],
  finance: [
    "1554224155-6726b3ff858f",
    "1556761175-b413da4baf72",
    "1579621970563-ebec7560ff3e",
    "1563013544-824ae1b704d3",
    "1526304640581-d334cdbbf45e",
    "1518546305927-5a555bb7020d",
    "1450101499163-c8848c66ca85",
    "1559526324-593bc073d938",
  ],
  travel: [
    "1507525428034-b723cf961d3e",
    "1476514525535-07fb3b4ae5f1",
    "1469474968028-56623f02e42e",
    "1500530855697-b586d89ba3ee",
    "1501785888041-af3ef285b470",
    "1470770841072-f978cf4d019e",
    "1500534314209-a25ddb2bd429",
    "1530789253388-582c481c54b0",
  ],
  people: [
    "1521737711867-e3b97375f902",
    "1517048676732-d65bc937f952",
    "1522071820081-009f0129c71c",
    "1556761175-5973dc0f32e7",
    "1529156069898-49953e39b3ac",
    "1524758631624-e2822e304c36",
    "1524504388940-b1c1722653e1",
    "1529333166437-7750a6dd5a70",
  ],
  generic: [
    "1497366811353-6870744d04b2",
    "1497366754035-f200968a6e72",
    "1524758631624-e2822e304c36",
    "1521737711867-e3b97375f902",
    "1497215728101-856f4ea42174",
    "1497366216548-37526070297c",
    "1497366412874-3415097a27e7",
    "1497215842964-222b430dc094",
  ],
});

const KEYWORD_PRESETS = Object.freeze({
  "real-estate": ["modern residential architecture", "bright apartment interior", "city neighborhood homes"],
  commerce: ["premium retail products", "modern boutique interior", "online shopping lifestyle"],
  logistics: ["cinematic freight truck", "modern warehouse logistics", "shipping containers port"],
  healthcare: ["modern private clinic", "doctor patient consultation", "medical care interior"],
  food: ["aesthetic restaurant dish", "premium cafe interior", "chef kitchen service"],
  education: ["modern classroom learning", "students collaborative study", "online education workspace"],
  finance: ["modern digital finance", "mobile payment lifestyle", "banking card premium"],
  travel: ["cinematic travel destination", "premium hotel interior", "city tourism lifestyle"],
  people: ["professional team portrait", "creative collaboration studio", "customer service specialist"],
  generic: ["premium product lifestyle", "modern service environment", "professional customer experience"],
});

export function derivePrototypeExperienceFamily({ productFamily = "business-app", semanticModel = {}, proposalModel = {} } = {}) {
  const text = JSON.stringify({
    title: proposalModel.title,
    brief: proposalModel.brief,
    project: semanticModel.project,
    scope: semanticModel.scopeItems || proposalModel.scope,
    capabilities: semanticModel.capabilities,
    tasks: semanticModel.tasks,
    processes: semanticModel.processes,
  }).toLowerCase();
  const explicitlyMentionsHouse = /(^|[^а-яё])дом([^а-яё]|$)/i.test(text);
  if (/real[ -]?estate|property|properties|apartment|housing|realtor|недвиж|квартир|жил(ь|и)|uy[ -]?top|риелтор|риэлтор/.test(text) || explicitlyMentionsHouse) return "real-estate";
  if (/\b(?:restaurant|cafe|coffee|food|meal|menu|taom)\b|ресторан|кафе|блюд/.test(text)) return "food";
  if (/clinic|doctor|patient|medical|health|hospital|клиник|врач|пациент|медицин/.test(text)) return "healthcare";
  if (/course|lesson|student|school|education|learning|курс|урок|студент|обучен|ta'lim/.test(text)) return "education";
  if (/travel|hotel|tour|booking|flight|trip|путешеств|отел|тур|брон/.test(text)) return "travel";
  if (["marketplace", "ecommerce"].includes(productFamily)) return "commerce";
  if (/logistic|shipment|fleet|transport|warehouse|courier|delivery|груз|логист|склад|курьер|достав/.test(text) || productFamily === "tms") return "logistics";
  if (/bank|finance|wallet|payment|invoice|bnpl|loan|card|банк|финанс|кошел|плат[её]ж|сч[её]т/.test(text) || productFamily === "fintech") return "finance";
  if (/catalog|product|cart|checkout|order|marketplace|e-?commerce|товар|каталог|корзин|заказ|маркетплейс/.test(text) || ["marketplace", "ecommerce"].includes(productFamily)) return "commerce";
  if (/team|employee|candidate|recruit|people|команд|сотруд|кандидат|персонал/.test(text)) return "people";
  return "generic";
}

export function derivePrototypeImageKeywords({ experienceFamily = "generic", proposalModel = {}, semanticModel = {} } = {}) {
  const preset = KEYWORD_PRESETS[experienceFamily] || KEYWORD_PRESETS.generic;
  const projectName = cleanText(semanticModel.project?.name || proposalModel.brief?.projectName || proposalModel.title, 50);
  return unique([...(projectName ? [`${preset[0]} ${projectName}`] : []), ...preset]).slice(0, 4);
}

export function buildCuratedPrototypeMedia({ experienceFamily = "generic", keywords = [] } = {}) {
  const selectedKeywords = unique(keywords.length ? keywords : KEYWORD_PRESETS[experienceFamily] || KEYWORD_PRESETS.generic).slice(0, 4);
  // Keep the offline fallback strictly inside the detected vertical. Mixing the
  // generic office pool into a real-estate, food, or healthcare prototype makes
  // otherwise useful cards look unrelated to the generated product.
  const ids = unique(CURATED_PHOTO_IDS[experienceFamily] || CURATED_PHOTO_IDS.generic).slice(0, MEDIA_LIMIT);
  return {
    source: "curated_unsplash",
    keywords: selectedKeywords,
    images: ids.map((photoId, index) => mediaImageFromUrl(
      `https://${UNSPLASH_IMAGE_HOST}/photo-${photoId}`,
      index,
      selectedKeywords[index % Math.max(1, selectedKeywords.length)] || experienceFamily,
    )),
    warnings: [],
  };
}

export async function resolveAppPrototypeMedia({
  productFamily = "business-app",
  experienceFamily,
  semanticModel = {},
  proposalModel = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedFamily = experienceFamily || derivePrototypeExperienceFamily({ productFamily, semanticModel, proposalModel });
  const keywords = derivePrototypeImageKeywords({ experienceFamily: resolvedFamily, proposalModel, semanticModel });
  const fallback = buildCuratedPrototypeMedia({ experienceFamily: resolvedFamily, keywords });
  const accessKey = String(env?.UNSPLASH_ACCESS_KEY || env?.UNSPLASH_ACCESS_KEY || "").trim();
  if (!accessKey || typeof fetchImpl !== "function") return fallback;
  try {
    const groups = await Promise.all(keywords.map((query) => searchUnsplash(fetchImpl, accessKey, query)));
    const selected = roundRobin(groups, MEDIA_LIMIT);
    if (selected.length < 6) return { ...fallback, warnings: ["Unsplash search returned fewer than six usable images; curated thematic pool used."] };
    return {
      source: "unsplash_api",
      keywords,
      images: selected.map((photo, index) => mediaImageFromUrl(photo.url, index, keywords[index % keywords.length], photo.photographer)),
      warnings: [],
    };
  } catch (error) {
    return { ...fallback, warnings: [`Unsplash search unavailable: ${cleanText(error?.message || "request failed", 120)}`] };
  }
}

async function searchUnsplash(fetchImpl, accessKey, query) {
  const url = new URL(UNSPLASH_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "12");
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");
  url.searchParams.set("order_by", "relevant");
  const response = await fetchImpl(url, {
    headers: { Authorization: `Client-ID ${accessKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Unsplash ${response.status}`);
  const payload = await response.json();
  return (payload.results || []).map((photo) => ({
    url: normalizeUnsplashUrl(photo?.urls?.raw),
    photographer: cleanText(photo?.user?.name, 80),
  })).filter((photo) => photo.url);
}

function normalizeUnsplashUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== UNSPLASH_IMAGE_HOST) return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function roundRobin(groups, limit) {
  const rows = [];
  const seen = new Set();
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength && rows.length < limit; index += 1) {
    for (const group of groups) {
      const photo = group[index];
      if (!photo?.url || seen.has(photo.url)) continue;
      seen.add(photo.url);
      rows.push(photo);
      if (rows.length >= limit) break;
    }
  }
  return rows;
}

function mediaImageFromUrl(baseUrl, index, alt, photographer = "") {
  const role = index < 3 ? "hero" : index < 8 ? "card" : "thumb";
  const size = role === "hero" ? [1600, 900] : role === "card" ? [900, 680] : [480, 360];
  const url = new URL(baseUrl);
  url.searchParams.set("auto", "format");
  url.searchParams.set("fit", "crop");
  url.searchParams.set("w", String(size[0]));
  url.searchParams.set("h", String(size[1]));
  url.searchParams.set("q", "82");
  return {
    id: `photo_${String(index + 1).padStart(2, "0")}`,
    url: url.toString(),
    alt: cleanText(alt || "Thematic product photo", 120),
    role,
    photographer: cleanText(photographer, 80),
  };
}

function unique(values) {
  return [...new Set(values.map((value) => cleanText(value, 120)).filter(Boolean))];
}

function cleanText(value, max) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
