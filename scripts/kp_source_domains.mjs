import { getDomain } from "tldts";

export function sourceOriginKey(source = {}, fallbackId = "") {
  const raw = String(source?.source || "").trim();
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return "";
    return getDomain(url.hostname, { allowPrivateDomains: true }) || "";
  } catch {
    return "";
  }
}
