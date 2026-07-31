import crypto from "node:crypto";

export function normalizeConfiguredApiKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/^(?:Bearer\s+)+/i, "")
    .trim();
}

export function parseBearerToken(value = "") {
  const match = String(value || "").trim().match(/^(?:Bearer\s+)+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function checkBearerAuthorization(configuredKey = "", authorizationHeader = "") {
  const expected = normalizeConfiguredApiKey(configuredKey);
  if (!expected) return { ok: true, reason: "disabled" };
  const supplied = parseBearerToken(authorizationHeader);
  if (!supplied) return { ok: false, reason: "required" };
  return secureTokenEqual(supplied, expected)
    ? { ok: true, reason: "accepted" }
    : { ok: false, reason: "invalid" };
}

function secureTokenEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left)).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}
