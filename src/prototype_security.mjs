const DEFAULT_FRAME_ANCESTORS = "'self' http://127.0.0.1:* http://localhost:* https://professio.ucode.co";

export function buildPrototypeContentSecurityPolicy(frameAncestorsValue) {
  const frameAncestors = normalizePrototypeFrameAncestors(frameAncestorsValue);
  return `default-src 'none'; img-src data: https://images.unsplash.com; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors ${frameAncestors}`;
}

export function normalizePrototypeFrameAncestors(value) {
  const normalized = String(value || DEFAULT_FRAME_ANCESTORS).trim();
  if (!normalized || /[\r\n;]/.test(normalized)) {
    throw new Error("KP_PROTOTYPE_FRAME_ANCESTORS contains invalid CSP characters");
  }
  return normalized;
}
