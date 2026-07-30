const CONTROL_EXCEPT_NORMALIZED_LINES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function escapeHtmlText(value = "") {
  const text = safeText(value);
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeHtmlAttribute(value = "") {
  return escapeHtmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeSvgText(value = "") {
  return escapeHtmlText(value);
}

export function safeDomId(value = "") {
  const encoded = String(value || "")
    .normalize("NFC")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return encoded || "id";
}

export function assertSafeRendererText(value = "") {
  safeText(value);
  return true;
}

function safeText(value = "") {
  const text = String(value ?? "").normalize("NFC");
  if (CONTROL_EXCEPT_NORMALIZED_LINES.test(text)) {
    throw Object.assign(new Error("Unsafe renderer text contains control characters"), { code: "DOM_UNSAFE_TEXT" });
  }
  return text;
}
