export const REFERENCE_CLASSIFICATION_CONFIDENCE_V1 = Object.freeze({
  explicit_negative: 1.00,
  explicit_text: 1.00,
  explicit_caption: 0.98,
  exact_reply_inherited: 0.92,
  album_caption_inherited: 0.90,
  filename_brandbook_or_logo: 0.74,
  filename_visual_reference: 0.70,
  known_visual_host_with_weak_style_signal: 0.68,
  mime_only_eligibility: 0.35,
});

const ROLE_PRIORITY = Object.freeze({
  brand_system: 90,
  visual_style: 80,
  product_analog: 60,
  logo_asset: 55,
  content_evidence: 45,
  data_source: 40,
  unknown: 10,
});

const ROLE_ASPECTS = Object.freeze({
  brand_system: {
    allow: ["logo", "palette", "tone", "typography", "composition", "density", "geometry", "diagramLanguage", "imagery"],
    deny: ["copy", "productSemantics"],
  },
  visual_style: {
    allow: ["palette", "tone", "typography", "composition", "density", "geometry", "diagramLanguage", "imagery"],
    deny: ["copy", "logo", "productSemantics"],
  },
  product_analog: {
    allow: ["productSemantics"],
    deny: ["logo", "palette", "tone", "typography", "composition", "density", "geometry", "diagramLanguage", "imagery", "copy"],
  },
  logo_asset: {
    allow: ["logo", "palette", "tone"],
    deny: ["composition", "density", "geometry", "diagramLanguage", "imagery", "copy", "productSemantics"],
  },
  content_evidence: {
    allow: ["copy", "productSemantics"],
    deny: ["logo", "palette", "tone", "typography", "composition", "density", "geometry", "diagramLanguage", "imagery"],
  },
  data_source: {
    allow: ["copy", "productSemantics"],
    deny: ["logo", "palette", "tone", "typography", "composition", "density", "geometry", "diagramLanguage", "imagery"],
  },
  unknown: {
    allow: [],
    deny: [],
  },
});

export function classifyReferenceRole(input = {}) {
  return toLegacyRoleResult(classifyReferenceIntent(input));
}

export function classifyReferenceIntent(input = {}) {
  const text = joinSignals(input.text, input.caption, input.replyContext, input.instruction);
  const fileName = String(input.fileName || "");
  const mimeType = String(input.mimeType || "");
  const url = String(input.url || "");
  const lowerText = text.toLowerCase();
  const lowerFile = fileName.toLowerCase();
  const lowerUrl = url.toLowerCase();
  const explicitMethod = methodForExplicitInput(input);

  if (/(не используй|ignore|только как контент|only as content|kontent sifatida)/i.test(text)) {
    return result("content_evidence", "explicit_negative", "User explicitly denied visual/reference use", { method: explicitMethod || "explicit_negative" });
  }
  if (/(brandbook|брендбук|brand guide|style guide|identity|айдентика|palette|палитра)/i.test(text)) {
    return result("brand_system", confidenceKeyForMethod(explicitMethod), "User explicitly identified brand identity material", { method: explicitMethod });
  }
  if (/(^|\s)(logo|логотип)(\s|$)/i.test(text)) {
    return result("logo_asset", confidenceKeyForMethod(explicitMethod), "User explicitly identified logo asset", { method: explicitMethod });
  }
  if (/(визуальн\w*\s+референс|референс\s+(дизайн|дизайна)|пример\s+дизайн|стиль\s+pdf|оформление|layout|композици|moodboard|look and feel|сделай как|inspiration|visual reference|design reference|shunaqa\s+stil|shunday\s+stil|shu(?:naqa)?\s+(?:rasm|dizayn|design|ui|ko['’]?rinish)|rasm(?:dagi|dek)\s+(?:stil|dizayn|design|ui)|huddi\s+shunaqa|xuddi\s+shunaqa|ushbu\s+(?:rasm|dizayn|ui))/i.test(text)) {
    return result("visual_style", confidenceKeyForMethod(explicitMethod), "User explicitly requested visual style", { method: explicitMethod });
  }
  if (/(аналог продукта|product analog|competitor|product benchmark|ux analog)/i.test(text) || (/как\s+(uzum|яндекс|amazon|uber|airbnb)/i.test(text) && /(механик|функц|поведен|ux|product|flow|user journey)/i.test(text))) {
    return result("product_analog", confidenceKeyForMethod(explicitMethod), "User explicitly supplied product analog", { method: explicitMethod });
  }
  if (/(тз|brief|requirements|контент|исследован|данные для кп|content evidence|scope|requirements doc|project card)/i.test(text)) {
    return result("content_evidence", confidenceKeyForMethod(explicitMethod), "User identified content evidence", { method: explicitMethod });
  }
  if (/(pricing|budget|roadmap|csv|xlsx|таблиц|data source|данные)/i.test(text) || /\.(csv|xlsx|xls|json)$/i.test(lowerFile)) {
    return result("data_source", confidenceKeyForMethod(explicitMethod), "User identified structured data", { method: explicitMethod });
  }

  if (/(brandbook|brand[-_ ]?guide|style[-_ ]?guide|guideline|identity|palette)/i.test(lowerFile)) {
    return result("brand_system", "filename_brandbook_or_logo", "Filename indicates brand identity material");
  }
  if (/(logo|логотип)/i.test(lowerFile)) return result("logo_asset", "filename_brandbook_or_logo", "Filename indicates logo asset");
  if (/(reference|moodboard|inspiration|visual|design|ref)/i.test(lowerFile)) {
    return result("visual_style", "filename_visual_reference", "Filename indicates visual reference");
  }
  if (/(behance|dribbble|pinterest|awwwards|readymag)/i.test(lowerUrl) && /(reference|style|design|референс|визуал)/i.test(lowerText)) {
    return result("visual_style", "known_visual_host_with_weak_style_signal", "Known visual host with nearby style signal");
  }
  if (/^image\//i.test(mimeType) || /pdf/i.test(mimeType) || /\.pdf(?:$|\?)/i.test(lowerFile) || /\.pdf(?:$|\?)/i.test(lowerUrl)) {
    return result("unknown", "mime_only_eligibility", "MIME type is eligible but role is unknown");
  }
  return result("unknown", "mime_only_eligibility", "No deterministic role signal");
}

export function classifyReferenceModeHint(input = {}) {
  const text = joinSignals(input.text, input.caption, input.instruction).toLowerCase();
  const role = input.primaryRole || input.role || classifyReferenceRole(input).role;
  if (/(без референс|ignore all references|no references)/i.test(text)) return "none";
  if (["brand_system", "visual_style"].includes(role)) return "explicit_full";
  if (["logo_asset"].includes(role) || input.themeTokens) return "explicit_partial";
  return "none";
}

export function assertExplicitInputsPreserved(candidateBundle = {}, storedBundle = {}) {
  const storedIds = new Set((storedBundle.items || []).map((item) => item.assetId));
  const lost = (candidateBundle.items || [])
    .filter((item) => ["brand_system", "visual_style", "logo_asset"].includes(item.role))
    .filter((item) => !storedIds.has(item.assetId));
  if (lost.length) {
    const error = new Error(`Explicit reference inputs were lost: ${lost.map((item) => item.assetId).join(", ")}`);
    error.code = "REF_EXPLICIT_INPUT_LOST";
    error.lostAssetIds = lost.map((item) => item.assetId);
    throw error;
  }
  if (candidateBundle.selectionTrace?.mode !== "none" && storedBundle.selectionTrace?.mode === "none") {
    const error = new Error("Explicit reference mode was downgraded to none");
    error.code = "REF_EXPLICIT_INPUT_LOST";
    throw error;
  }
  return true;
}

export function referenceKindFromInput(input = {}) {
  const mimeType = String(input.mimeType || "");
  const fileName = String(input.fileName || input.storedPath || input.url || "");
  if (input.url && !input.storedPath) return /\.pdf(?:$|\?)/i.test(input.url) ? "pdf" : "url";
  if (/pdf/i.test(mimeType) || /\.pdf$/i.test(fileName)) return "pdf";
  if (/^image\//i.test(mimeType) || /\.(png|jpe?g|webp|gif)$/i.test(fileName)) return "image";
  if (/logo/i.test(fileName)) return "logo";
  if (/^audio\//i.test(mimeType)) return "audio";
  if (/text|markdown|json|csv/i.test(mimeType) || /\.(txt|md|json|csv)$/i.test(fileName)) return "text";
  return "unknown";
}

export function rolePriority(role = "unknown") {
  return ROLE_PRIORITY[role] || ROLE_PRIORITY.unknown;
}

function result(primaryRole, confidenceKey, rationale, { method = null } = {}) {
  const aspects = ROLE_ASPECTS[primaryRole] || ROLE_ASPECTS.unknown;
  const stableMethod = method || confidenceKey;
  return {
    primaryRole,
    role: primaryRole,
    secondaryRoles: [],
    confidence: REFERENCE_CLASSIFICATION_CONFIDENCE_V1[confidenceKey],
    method: stableMethod,
    rationale,
    aspectAllow: aspects.allow,
    aspectDeny: aspects.deny,
    modeHint: classifyReferenceModeHint({ role: primaryRole }),
    priority: rolePriority(primaryRole),
  };
}

function toLegacyRoleResult(intent) {
  return {
    role: intent.primaryRole,
    secondaryRoles: intent.secondaryRoles,
    confidence: intent.confidence,
    method: intent.method,
    rationale: intent.rationale,
    aspectAllow: intent.aspectAllow,
    aspectDeny: intent.aspectDeny,
    priority: rolePriority(intent.primaryRole),
  };
}

function methodForExplicitInput(input = {}) {
  if (input.classificationMethodHint === "album_caption_inherited") return "album_caption_inherited";
  if (input.selectionSource === "reply" || input.exactReply) return "exact_reply_inherited";
  if (input.caption && !input.text) return "explicit_caption";
  return "explicit_text";
}

function confidenceKeyForMethod(method) {
  if (["explicit_caption", "exact_reply_inherited", "album_caption_inherited"].includes(method)) return method;
  return "explicit_text";
}

function joinSignals(...values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join("\n");
}
