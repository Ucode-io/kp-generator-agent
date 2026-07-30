import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, canonicalJson, sha256Digest, sha256Hex, validateKpContract } from "./kp_reference_contracts.mjs";
import { assertExplicitInputsPreserved, classifyReferenceRole, referenceKindFromInput, rolePriority } from "./kp_reference_classifier.mjs";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PURGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RESERVATION_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ACTIVE_ASSETS = 12;
const DEFAULT_MAX_ACTIVE_SET_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const STORE_ROOT = path.join(process.cwd(), "data", "kp_reference_sessions");

export function buildReferenceSessionKey({ chatId, userId, threadId = 0 } = {}) {
  return [chatId ?? "unknown-chat", userId ?? "unknown-user", threadId ?? 0].map(String).join(":");
}

export function sessionPathForKey(sessionKey, { storeRoot = STORE_ROOT } = {}) {
  return path.join(storeRoot, `session-${sha256Hex(sessionKey)}.json`);
}

export async function loadReferenceSession(sessionKey, options = {}) {
  const sessionPath = sessionPathForKey(sessionKey, options);
  try {
    const session = JSON.parse(await fs.readFile(sessionPath, "utf8"));
    validateSessionInvariants(session);
    return session;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const now = new Date().toISOString();
    return {
      schemaVersion: "1.0",
      sessionKey,
      sessionKeyHash: sha256Digest(sessionKey),
      activeSetId: null,
      sets: [],
      assets: [],
      updatedAt: now,
    };
  }
}

export async function saveReferenceSession(session, options = {}) {
  validateSessionInvariants(session);
  return atomicWriteJson(sessionPathForKey(session.sessionKey, options), session, { schemaName: "referenceSessionStore" });
}

export async function ingestReferenceItems(sessionKey, items = [], options = {}) {
  const now = options.now || new Date();
  const ttlMs = Number(options.ttlMs || process.env.KP_REFERENCE_ACTIVE_SET_TTL_MS || DEFAULT_TTL_MS);
  const maxFileBytes = Number(options.maxFileBytes || process.env.KP_REFERENCE_MAX_FILE_BYTES || DEFAULT_MAX_FILE_BYTES);
  const maxActiveAssets = Number(options.maxActiveAssets || DEFAULT_MAX_ACTIVE_ASSETS);
  const maxActiveSetBytes = Number(options.maxActiveSetBytes || DEFAULT_MAX_ACTIVE_SET_BYTES);
  const session = await loadReferenceSession(sessionKey, options);
  expireOldAssets(session, now);
  const activeSet = ensureActiveSet(session, now);
  const added = [];
  for (const input of items) {
    const classified = classifyReferenceRole(input);
    const kind = referenceKindFromInput(input);
    const fingerprint = await assetFingerprint(input);
    const sizeBytes = Number(input.sizeBytes || input.size || await statSize(input.storedPath || input.path) || 0);
    if (sizeBytes > maxFileBytes) throw Object.assign(new Error(`Reference file exceeds ${maxFileBytes} bytes`), { code: "KP_REF_FILE_TOO_LARGE", sizeBytes, maxFileBytes });
    const existing = session.assets.find((asset) => asset.sha256 === fingerprint || (input.url && asset.url === input.url));
    if (!existing) assertActiveSetCapacity(session, activeSet, { sizeBytes, maxActiveAssets, maxActiveSetBytes });
    const asset = existing || {
      assetId: `ASSET-${fingerprint.replace(/^sha256:/, "").slice(0, 16).toUpperCase()}`,
      kind,
      role: classified.role,
      secondaryRoles: classified.secondaryRoles,
      status: "pending",
      priority: classified.priority,
      classificationConfidence: classified.confidence,
      classificationMethod: classified.method,
      classificationRationale: classified.rationale || null,
      aspectAllow: classified.aspectAllow || [],
      aspectDeny: classified.aspectDeny || [],
      origins: [],
      fileName: input.fileName || null,
      mimeType: input.mimeType || null,
      storedPath: input.storedPath || input.path || null,
      url: input.url || null,
      sha256: fingerprint,
      sizeBytes,
      caption: input.caption || input.text || null,
      instruction: input.instruction || input.text || input.caption || null,
      autoSelectableUntil: new Date(now.getTime() + ttlMs).toISOString(),
      purgeAfter: new Date(now.getTime() + Number(options.purgeMs || DEFAULT_PURGE_MS)).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      reservations: [],
      consumptions: [],
      warnings: [],
    };
    if (existing) {
      if (["expired", "cleared", "consumed"].includes(existing.status)) {
        existing.status = "pending";
        existing.autoSelectableUntil = new Date(now.getTime() + ttlMs).toISOString();
        existing.purgeAfter = new Date(now.getTime() + Number(options.purgeMs || DEFAULT_PURGE_MS)).toISOString();
      }
      const strongerClassification = classified.role !== "unknown"
        && Number(classified.confidence || 0) > Number(existing.classificationConfidence || 0);
      if (strongerClassification) {
        existing.role = classified.role;
        existing.secondaryRoles = classified.secondaryRoles;
        existing.priority = classified.priority;
        existing.classificationConfidence = classified.confidence;
        existing.classificationMethod = classified.method;
        existing.classificationRationale = classified.rationale || null;
        existing.aspectAllow = classified.aspectAllow || [];
        existing.aspectDeny = classified.aspectDeny || [];
      }
      if (input.caption || input.text) existing.caption = input.caption || input.text;
      if (input.instruction || input.text || input.caption) existing.instruction = input.instruction || input.text || input.caption;
      if (!existing.fileName && input.fileName) existing.fileName = input.fileName;
      if (!existing.mimeType && input.mimeType) existing.mimeType = input.mimeType;
    }
    asset.origins.push(...normalizeOrigins(input, now));
    asset.updatedAt = now.toISOString();
    if (!existing) session.assets.push(asset);
    if (!activeSet.assetIds.includes(asset.assetId)) activeSet.assetIds.push(asset.assetId);
    added.push(asset);
  }
  activeSet.updatedAt = now.toISOString();
  session.updatedAt = now.toISOString();
  await saveReferenceSession(session, options);
  return { session, added, activeSet };
}

export async function ingestTelegramReferenceMessages(messages = [], options = {}) {
  const ordered = [...messages].sort((a, b) => Number(a.messageId || a.message_id || 0) - Number(b.messageId || b.message_id || 0));
  const inheritedCaption = ordered.map((message) => message.caption || message.text || "").find(Boolean) || "";
  const sessionKey = options.sessionKey || buildReferenceSessionKey({
    chatId: options.chatId ?? ordered[0]?.chatId ?? ordered[0]?.chat?.id,
    userId: options.userId ?? ordered[0]?.userId ?? ordered[0]?.from?.id,
    threadId: options.threadId ?? ordered[0]?.messageThreadId ?? ordered[0]?.message_thread_id ?? 0,
  });
  const items = ordered.flatMap((message) => {
    const files = message.files || message.attachments || (message.file ? [message.file] : []);
    return files.map((file) => ({
      ...file,
      text: message.caption || inheritedCaption,
      caption: message.caption || inheritedCaption || null,
      messageId: message.messageId ?? message.message_id ?? null,
      uploaderUserId: message.userId ?? message.from?.id ?? options.userId ?? null,
      mediaGroupId: message.mediaGroupId ?? message.media_group_id ?? null,
      classificationMethodHint: message.caption ? "explicit_caption" : inheritedCaption ? "album_caption_inherited" : null,
    }));
  });
  return ingestReferenceItems(sessionKey, items, options);
}

export async function listActiveReferences(sessionKey, options = {}) {
  const now = options.now || new Date();
  const session = await loadReferenceSession(sessionKey, options);
  expireOldAssets(session, now);
  const active = activeAssets(session, now);
  await saveReferenceSession(session, options);
  return active.sort(referenceSort);
}

export async function loadActiveReferenceSet(sessionKey, options = {}) {
  const now = options.now || new Date();
  const session = await loadReferenceSession(sessionKey, options);
  reconcileExpiredLeasesInSession(session, now);
  expireOldAssets(session, now);
  const set = session.sets.find((item) => item.setId === session.activeSetId) || null;
  return {
    session,
    set,
    assets: activeAssets(session, now).sort(referenceSort),
    derivedStatus: deriveSetStatus(session, set, now),
  };
}

export async function clearActiveReferences(sessionKey, options = {}) {
  const now = options.now || new Date();
  const session = await loadReferenceSession(sessionKey, options);
  reconcileExpiredLeasesInSession(session, now);
  const set = session.sets.find((item) => item.setId === session.activeSetId);
  if (set) {
    set.status = "cleared";
    set.updatedAt = now.toISOString();
    for (const asset of session.assets.filter((item) => set.assetIds.includes(item.assetId))) {
      if (asset.status === "pending" && !hasLiveReservation(asset, now)) {
        asset.status = "cleared";
        asset.updatedAt = now.toISOString();
      }
    }
  }
  session.activeSetId = null;
  session.updatedAt = now.toISOString();
  await saveReferenceSession(session, options);
  return session;
}

export const clearReferenceSet = clearActiveReferences;

export async function selectStoredEvidenceBundle(sessionKey, requestContext, options = {}) {
  const now = options.now || new Date();
  const session = await loadReferenceSession(sessionKey, options);
  expireOldAssets(session, now);
  const active = activeAssets(session, now).sort(referenceSort);
  const currentIds = new Set(options.currentAssetIds || []);
  const replyIds = new Set(options.replyAssetIds || []);
  let candidatePool = active;
  const rulesApplied = [];
  if (currentIds.size || replyIds.size) {
    candidatePool = active.filter((asset) => currentIds.has(asset.assetId) || replyIds.has(asset.assetId));
    rulesApplied.push("current_reply_exclude_unrelated_pending");
  } else {
    rulesApplied.push("pending_session");
  }
  const selected = candidatePool.slice(0, Number(options.limit || 12));
  const instructionClassification = classifyReferenceRole({
    text: options.instruction || "",
    instruction: options.instruction || "",
  });
  for (const asset of selected) {
    if (asset.role !== "unknown") continue;
    const shouldUseInstruction = instructionClassification.role !== "unknown";
    const shouldAssumeImageStyle = options.assumeImageVisualStyle === true && asset.kind === "image";
    if (!shouldUseInstruction && !shouldAssumeImageStyle) continue;
    const promoted = shouldUseInstruction
      ? instructionClassification
      : classifyReferenceRole({
          text: "visual reference",
          instruction: "visual reference",
          mimeType: asset.mimeType,
          fileName: asset.fileName,
        });
    asset.role = promoted.role;
    asset.secondaryRoles = promoted.secondaryRoles;
    asset.priority = promoted.priority;
    asset.classificationConfidence = shouldUseInstruction ? promoted.confidence : 0.9;
    asset.classificationMethod = shouldUseInstruction ? "followup_instruction" : "kp_image_default_visual_style";
    asset.classificationRationale = shouldUseInstruction
      ? "Pending image role resolved from the current KP instruction"
      : "Image attached to a KP request defaults to a visual style reference";
    asset.aspectAllow = promoted.aspectAllow || [];
    asset.aspectDeny = promoted.aspectDeny || [];
    asset.instruction = options.instruction || asset.instruction || "visual reference";
    asset.updatedAt = now.toISOString();
    rulesApplied.push(shouldUseInstruction ? "current_instruction_promoted_pending_image" : "kp_image_defaults_to_visual_style");
  }
  const mode = selected.some((asset) => ["brand_system", "visual_style"].includes(asset.role))
    ? "explicit_full"
    : selected.length
      ? "explicit_partial"
      : "none";
  const bundle = {
    schemaVersion: "1.0",
    requestId: requestContext.requestId,
    sessionKeyHash: session.sessionKeyHash,
    intakeFingerprint: intakeFingerprint(selected.map((asset) => candidateItemFromAsset(asset, "pending"))),
    items: selected.map((asset) => ({
      assetId: asset.assetId,
      selectionSource: "pending",
      storedPath: asset.storedPath,
      url: asset.url,
      sha256: asset.sha256,
      messageId: asset.origins.find((origin) => Number.isFinite(Number(origin.messageId)))?.messageId ?? null,
      uploaderUserId: asset.origins.find((origin) => origin.uploaderUserId)?.uploaderUserId ?? null,
    })),
    selectionTrace: {
      mode,
      includedAssetIds: selected.map((asset) => asset.assetId),
      excluded: activeAssets(session, now)
        .filter((asset) => !selected.includes(asset))
        .map((asset) => ({
          assetId: asset.assetId,
          reason: currentIds.size || replyIds.size ? "unrelated_pending_excluded_by_current_or_reply" : "selection_limit",
        })),
      primaryAssetId: selected[0]?.assetId || null,
      primaryReason: selected[0] ? "role_priority_then_message_order" : null,
      selector: null,
      rulesApplied: [...rulesApplied, "deterministic_role_priority"],
      ordinalBase: 1,
    },
  };
  await saveReferenceSession(session, options);
  await validateKpContract("storedEvidenceBundle", bundle);
  return bundle;
}

export async function assembleCandidateEvidenceBundle({
  requestIdentity = {},
  telegramBundle = null,
  evidenceBundle = null,
  logoAssets = [],
  fontAssets = [],
  themeTokens = null,
  brandReferences = [],
  visualStyleReferences = [],
  productAnalogs = [],
} = {}) {
  const sessionKeyHash = requestIdentity.sessionKeyHash || telegramBundle?.sessionKeyHash || evidenceBundle?.sessionKeyHash || sha256Digest("kp:candidate:anonymous");
  const rawItems = [
    ...itemsFromStoredBundle(telegramBundle, "pending"),
    ...itemsFromStoredBundle(evidenceBundle, "test"),
    ...brandReferences.map((item) => ({ ...item, role: "brand_system", selectionSource: item.selectionSource || "current" })),
    ...visualStyleReferences.map((item) => ({ ...item, role: "visual_style", selectionSource: item.selectionSource || "current" })),
    ...productAnalogs.map((item) => ({ ...item, role: "product_analog", selectionSource: item.selectionSource || "current" })),
    ...logoAssets.map((item) => ({ ...item, role: "logo_asset", selectionSource: item.selectionSource || "current" })),
    ...fontAssets.map((item) => ({ ...item, role: "brand_system", kind: "stored_file", selectionSource: item.selectionSource || "current" })),
    ...(themeTokens ? [{ assetId: themeTokens.assetId || `ASSET-${sha256Hex(canonicalJson(themeTokens)).slice(0, 16).toUpperCase()}`, kind: "inline_theme_tokens", role: "brand_system", selectionSource: "current", themeTokens }] : []),
  ];
  const items = dedupeCandidateItems(rawItems.map(normalizeCandidateItem));
  const mode = items.some((item) => ["brand_system", "visual_style"].includes(item.role))
    ? "explicit_full"
    : items.some((item) => item.role === "logo_asset" || item.kind === "inline_theme_tokens")
      ? "explicit_partial"
      : "none";
  const bundle = {
    schemaVersion: "1.0",
    sessionKeyHash,
    intakeFingerprint: intakeFingerprint(items),
    items,
    selectionTrace: {
      mode,
      includedAssetIds: items.map((item) => item.assetId),
      excluded: [],
      primaryAssetId: items.find((item) => ["brand_system", "visual_style"].includes(item.role))?.assetId || items[0]?.assetId || null,
      primaryReason: items.length ? "candidate_input_order" : null,
      selector: null,
      rulesApplied: ["candidate_two_phase_union", "dedupe_by_asset_hash_or_url"],
      ordinalBase: 1,
    },
  };
  await validateKpContract("candidateEvidenceBundle", bundle);
  return deepFreeze(bundle);
}

export async function finalizeStoredEvidenceBundle(candidateBundle, requestContext) {
  await validateKpContract("candidateEvidenceBundle", candidateBundle);
  await validateKpContract("requestContext", requestContext);
  if (intakeFingerprint(candidateBundle.items) !== candidateBundle.intakeFingerprint) {
    const error = new Error("Candidate intake fingerprint changed during finalization");
    error.code = "REF_EXPLICIT_INPUT_LOST";
    throw error;
  }
  const bundle = {
    schemaVersion: "1.0",
    requestId: requestContext.requestId,
    sessionKeyHash: candidateBundle.sessionKeyHash,
    intakeFingerprint: candidateBundle.intakeFingerprint,
    items: candidateBundle.items.map((item) => ({
      assetId: item.assetId,
      selectionSource: item.selectionSource,
      storedPath: item.storedPath,
      url: item.url,
      sha256: item.sha256,
      messageId: item.messageId ?? null,
      uploaderUserId: item.uploaderUserId ?? null,
    })),
    selectionTrace: { ...candidateBundle.selectionTrace },
  };
  await validateKpContract("storedEvidenceBundle", bundle);
  assertExplicitInputsPreserved(candidateBundle, bundle);
  return deepFreeze(bundle);
}

export async function reserveReferenceAssets(sessionKey, requestId, assetIds = [], options = {}) {
  return reserveReferenceSet({ sessionKey, requestId, assetIds, ...options });
}

export async function reserveReferenceSet({ sessionKey, requestId, assetIds = [], ownerInstanceIdHash = sha256Digest(`pid:${process.pid}`), now = new Date(), leaseMs = DEFAULT_RESERVATION_LEASE_MS, ...options } = {}) {
  const timestamp = now.toISOString();
  const session = await loadReferenceSession(sessionKey, options);
  reconcileExpiredLeasesInSession(session, now);
  for (const asset of session.assets.filter((item) => assetIds.includes(item.assetId))) {
    const conflicting = (asset.reservations || []).find((reservation) => reservation.requestId !== requestId && Date.parse(reservation.leaseExpiresAt || reservation.at || 0) > now.getTime());
    if (conflicting) throw Object.assign(new Error(`Reference asset ${asset.assetId} is reserved by another request`), { code: "KP_REF_RESERVATION_CONFLICT", assetId: asset.assetId });
    const existing = asset.reservations.find((reservation) => reservation.requestId === requestId);
    const lease = {
      requestId,
      reservedAt: existing?.reservedAt || existing?.at || timestamp,
      heartbeatAt: timestamp,
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      ownerInstanceIdHash,
    };
    if (existing) Object.assign(existing, lease);
    else {
      asset.reservations.push(lease);
    }
    if (asset.status === "pending") asset.status = "reserved";
    asset.updatedAt = timestamp;
  }
  session.updatedAt = timestamp;
  await saveReferenceSession(session, options);
  return session;
}

export async function renewReferenceReservation(input, legacyRequestId = null, legacyOptions = {}) {
  const params = typeof input === "string"
    ? { sessionKey: input, requestId: legacyRequestId, ...legacyOptions }
    : { ...input };
  const { sessionKey, requestId, assetIds = [], ownerInstanceIdHash = sha256Digest(`pid:${process.pid}`), now = new Date(), leaseMs = DEFAULT_RESERVATION_LEASE_MS, ...options } = params;
  const timestamp = now.toISOString();
  const session = await loadReferenceSession(sessionKey, options);
  const targets = assetIds.length ? session.assets.filter((item) => assetIds.includes(item.assetId)) : session.assets;
  for (const asset of targets) {
    const reservation = (asset.reservations || []).find((item) => item.requestId === requestId);
    if (!reservation) throw Object.assign(new Error(`Reference reservation missing for ${asset.assetId}`), { code: "KP_REF_RESERVATION_LOST", assetId: asset.assetId });
    assertReservationOwner(reservation, ownerInstanceIdHash);
    reservation.heartbeatAt = timestamp;
    reservation.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    asset.updatedAt = timestamp;
  }
  session.updatedAt = timestamp;
  await saveReferenceSession(session, options);
  return session;
}

export async function releaseReferenceReservation(input, legacyRequestId = null, legacyOptions = {}) {
  const params = typeof input === "string"
    ? { sessionKey: input, requestId: legacyRequestId, ...legacyOptions }
    : { ...input };
  const { sessionKey, requestId, assetIds = [], ownerInstanceIdHash = null, now = new Date(), reason = "released", ...options } = params;
  const timestamp = now.toISOString();
  const session = await loadReferenceSession(sessionKey, options);
  const targets = assetIds.length ? session.assets.filter((item) => assetIds.includes(item.assetId)) : session.assets;
  for (const asset of targets) {
    for (const reservation of asset.reservations.filter((item) => item.requestId === requestId)) {
      if (ownerInstanceIdHash) assertReservationOwner(reservation, ownerInstanceIdHash);
    }
    asset.reservations = asset.reservations.filter((reservation) => reservation.requestId !== requestId);
    if (asset.status === "reserved" && !asset.reservations.length && !asset.consumptions.length) asset.status = "pending";
    if (reason) asset.warnings = [...(asset.warnings || []), `reservation_${reason}`].slice(-12);
    asset.updatedAt = timestamp;
  }
  session.updatedAt = timestamp;
  await saveReferenceSession(session, options);
  return session;
}

export async function markReferenceAssetsConsumed(sessionKey, requestId, assetIds = [], options = {}) {
  return markReferenceSetConsumed({ sessionKey, requestId, assetIds, ...options });
}

export async function markReferenceSetConsumed({ sessionKey, requestId, assetIds = [], ownerInstanceIdHash = null, now = new Date(), ...options } = {}) {
  const timestamp = now.toISOString();
  const session = await loadReferenceSession(sessionKey, options);
  for (const asset of session.assets.filter((item) => assetIds.includes(item.assetId))) {
    for (const reservation of asset.reservations.filter((item) => item.requestId === requestId)) {
      if (ownerInstanceIdHash) assertReservationOwner(reservation, ownerInstanceIdHash);
    }
    if (!asset.consumptions.some((consumption) => consumption.requestId === requestId)) {
      asset.consumptions.push({ requestId, consumedAt: timestamp });
    }
    asset.reservations = asset.reservations.filter((reservation) => reservation.requestId !== requestId);
    asset.status = "consumed";
    asset.updatedAt = timestamp;
  }
  session.updatedAt = timestamp;
  await saveReferenceSession(session, options);
  return session;
}

export async function reconcileExpiredReservations({ now = new Date(), storeRoot = STORE_ROOT, requestRecordReader = null } = {}) {
  const results = [];
  await fs.mkdir(storeRoot, { recursive: true });
  const files = await fs.readdir(storeRoot).catch(() => []);
  for (const file of files.filter((name) => /^session-.*\.json$/.test(name))) {
    const filePath = path.join(storeRoot, file);
    const session = JSON.parse(await fs.readFile(filePath, "utf8"));
    const changed = reconcileExpiredLeasesInSession(session, now, { requestRecordReader });
    if (changed) {
      await saveReferenceSession(session, { storeRoot });
      results.push({ sessionKeyHash: session.sessionKeyHash, released: changed });
    }
  }
  return results;
}

export async function cleanupExpiredReferenceSets(now = new Date(), { storeRoot = STORE_ROOT } = {}) {
  const cleaned = [];
  await fs.mkdir(storeRoot, { recursive: true });
  const files = await fs.readdir(storeRoot).catch(() => []);
  for (const file of files.filter((name) => /^session-.*\.json$/.test(name))) {
    const session = JSON.parse(await fs.readFile(path.join(storeRoot, file), "utf8"));
    let changed = reconcileExpiredLeasesInSession(session, now);
    for (const set of session.sets || []) {
      const assets = session.assets.filter((asset) => set.assetIds.includes(asset.assetId));
      const purgeAfter = Math.max(...assets.map((asset) => Date.parse(asset.purgeAfter || 0)).filter(Number.isFinite), 0);
      if (purgeAfter && purgeAfter < now.getTime() && !assets.some((asset) => hasLiveReservation(asset, now))) {
        for (const asset of assets) {
          asset.status = "expired";
          asset.updatedAt = now.toISOString();
        }
        set.status = "expired";
        set.updatedAt = now.toISOString();
        cleaned.push(set.setId);
        changed += 1;
      }
    }
    if (changed) await saveReferenceSession(session, { storeRoot });
  }
  return { cleaned };
}

function ensureActiveSet(session, now) {
  let active = session.sets.find((set) => set.setId === session.activeSetId && set.status === "active");
  if (!active) {
    active = {
      setId: `RSET-${now.getTime().toString(36).toUpperCase()}`,
      status: "active",
      assetIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    session.sets.push(active);
    session.activeSetId = active.setId;
  }
  return active;
}

function activeAssets(session, now = new Date()) {
  const active = session.sets.find((set) => set.setId === session.activeSetId && set.status === "active");
  if (!active) return [];
  return session.assets.filter((asset) => active.assetIds.includes(asset.assetId)
    && ["pending", "reserved"].includes(asset.status)
    && !hasLiveReservation(asset, now));
}

function expireOldAssets(session, now) {
  for (const asset of session.assets) {
    if (asset.status !== "pending" || !asset.autoSelectableUntil) continue;
    if (Date.parse(asset.autoSelectableUntil) < now.getTime()) {
      asset.status = "expired";
      asset.updatedAt = now.toISOString();
    }
  }
}

async function assetFingerprint(input) {
  if (input.sha256) return String(input.sha256).startsWith("sha256:") ? input.sha256 : `sha256:${input.sha256}`;
  if (input.storedPath || input.path) {
    const buffer = await fs.readFile(input.storedPath || input.path);
    return sha256Digest(buffer);
  }
  if (input.url) return sha256Digest(`url:${input.url}`);
  return sha256Digest(JSON.stringify({ fileName: input.fileName, mimeType: input.mimeType, text: input.text, caption: input.caption }));
}

function candidateItemFromAsset(asset, selectionSource = "pending") {
  return {
    assetId: asset.assetId,
    kind: asset.url && !asset.storedPath ? "url" : "stored_file",
    role: asset.role,
    selectionSource,
    storedPath: asset.storedPath,
    url: asset.url,
    sha256: asset.sha256,
    messageId: asset.origins?.find((origin) => Number.isFinite(Number(origin.messageId)))?.messageId ?? null,
    uploaderUserId: asset.origins?.find((origin) => origin.uploaderUserId)?.uploaderUserId ?? null,
    themeTokens: null,
  };
}

function normalizeCandidateItem(input = {}) {
  const url = input.url || null;
  const storedPath = input.storedPath || input.path || null;
  const sha256 = input.sha256 ? (String(input.sha256).startsWith("sha256:") ? input.sha256 : `sha256:${input.sha256}`) : null;
  const role = input.role || classifyReferenceRole(input).role;
  const kind = input.kind === "inline_theme_tokens" ? "inline_theme_tokens" : (url && !storedPath ? "url" : "stored_file");
  const assetId = input.assetId || `ASSET-${sha256Hex(canonicalJson({ kind, role, storedPath, url, sha256, themeTokens: input.themeTokens || null })).slice(0, 16).toUpperCase()}`;
  return {
    assetId,
    kind,
    role,
    selectionSource: input.selectionSource || "current",
    storedPath,
    url,
    sha256: sha256 || (url ? sha256Digest(`url:${url}`) : input.themeTokens ? sha256Digest(canonicalJson(input.themeTokens)) : null),
    messageId: input.messageId ?? null,
    uploaderUserId: input.uploaderUserId ? String(input.uploaderUserId) : null,
    themeTokens: input.themeTokens || null,
  };
}

function itemsFromStoredBundle(bundle, fallbackSelectionSource) {
  return (bundle?.items || []).map((item) => ({
    ...item,
    kind: item.url && !item.storedPath ? "url" : "stored_file",
    role: item.role || "unknown",
    selectionSource: item.selectionSource || fallbackSelectionSource,
  }));
}

function dedupeCandidateItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.sha256 || item.url || item.assetId;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function intakeFingerprint(items = []) {
  return sha256Digest(canonicalJson(items.map((item) => ({
    assetId: item.assetId,
    kind: item.kind,
    role: item.role,
    storedPath: item.storedPath ? "[stored-file]" : null,
    url: item.url,
    sha256: item.sha256,
    themeTokenHash: item.themeTokens ? sha256Digest(canonicalJson(item.themeTokens)) : null,
  })).sort((a, b) => a.assetId.localeCompare(b.assetId))));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizeOrigins(input, now) {
  return [{
    type: input.originType || input.source || "telegram_attachment",
    messageId: input.messageId ?? null,
    uploaderUserId: input.uploaderUserId ? String(input.uploaderUserId) : null,
    mediaGroupId: input.mediaGroupId ?? null,
    capturedAt: now.toISOString(),
  }];
}

function referenceSort(a, b) {
  return rolePriority(b.role) - rolePriority(a.role)
    || Number(b.classificationConfidence || 0) - Number(a.classificationConfidence || 0)
    || Date.parse(a.createdAt) - Date.parse(b.createdAt)
    || a.assetId.localeCompare(b.assetId);
}

function validateSessionInvariants(session) {
  const setIds = new Set();
  for (const set of session.sets || []) {
    if (setIds.has(set.setId)) throw invariant("KP_REF_DUPLICATE_SET_ID", `Duplicate reference setId ${set.setId}`);
    setIds.add(set.setId);
  }
  const assetIds = new Set();
  for (const asset of session.assets || []) {
    if (assetIds.has(asset.assetId)) throw invariant("KP_REF_DUPLICATE_ASSET_ID", `Duplicate assetId ${asset.assetId}`);
    assetIds.add(asset.assetId);
    const reserved = new Set((asset.reservations || []).map((item) => item.requestId));
    for (const consumption of asset.consumptions || []) {
      if (reserved.has(consumption.requestId)) {
        throw invariant("KP_REF_RESERVED_AND_CONSUMED", `${asset.assetId} has live reservation and consumption for ${consumption.requestId}`);
      }
    }
  }
}

function hasLiveReservation(asset, now = new Date()) {
  return (asset.reservations || []).some((reservation) => Date.parse(reservation.leaseExpiresAt || reservation.at || 0) > now.getTime());
}

function assertReservationOwner(reservation, ownerInstanceIdHash) {
  if (reservation.ownerInstanceIdHash && reservation.ownerInstanceIdHash !== ownerInstanceIdHash) {
    throw Object.assign(new Error("Reference reservation owner mismatch"), { code: "KP_REF_RESERVATION_OWNER_MISMATCH" });
  }
}

function reconcileExpiredLeasesInSession(session, now = new Date()) {
  let released = 0;
  for (const asset of session.assets || []) {
    const before = asset.reservations?.length || 0;
    asset.reservations = (asset.reservations || []).filter((reservation) => {
      const live = Date.parse(reservation.leaseExpiresAt || reservation.at || 0) > now.getTime();
      if (!live) asset.warnings = [...(asset.warnings || []), "orphan_reservation_released"].slice(-12);
      return live;
    });
    released += before - asset.reservations.length;
    if (asset.status === "reserved" && !asset.reservations.length && !asset.consumptions.length) {
      asset.status = "pending";
      asset.updatedAt = now.toISOString();
    }
  }
  if (released) session.updatedAt = now.toISOString();
  return released;
}

function deriveSetStatus(session, set, now = new Date()) {
  if (!set) return "none";
  if (set.status === "cleared") return "cleared";
  const assets = session.assets.filter((asset) => set.assetIds.includes(asset.assetId));
  if (assets.some((asset) => hasLiveReservation(asset, now))) return "reserved";
  if (assets.length && assets.every((asset) => asset.consumptions?.length)) return "consumed";
  if (assets.length && assets.every((asset) => Date.parse(asset.autoSelectableUntil || 0) < now.getTime())) return "expired";
  return "collecting";
}

function invariant(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function statSize(filePath) {
  if (!filePath) return 0;
  return (await fs.stat(filePath).catch(() => ({ size: 0 }))).size;
}

function assertActiveSetCapacity(session, activeSet, { sizeBytes, maxActiveAssets, maxActiveSetBytes }) {
  const activeAssetIds = new Set(activeSet.assetIds || []);
  if (activeAssetIds.size >= maxActiveAssets) throw Object.assign(new Error("Reference active set asset limit exceeded"), { code: "KP_REF_ACTIVE_SET_LIMIT_EXCEEDED" });
  const currentBytes = session.assets
    .filter((asset) => activeAssetIds.has(asset.assetId))
    .reduce((sum, asset) => sum + Number(asset.sizeBytes || 0), 0);
  if (currentBytes + sizeBytes > maxActiveSetBytes) throw Object.assign(new Error("Reference active set byte limit exceeded"), { code: "KP_REF_ACTIVE_SET_BYTES_EXCEEDED" });
}
