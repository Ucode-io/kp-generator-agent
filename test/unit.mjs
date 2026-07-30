import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { agentConfig, normalizeProfileContrast } from "../src/agent.mjs";
import { AGENT_ROOT } from "../src/root.mjs";

const config = agentConfig({});
assert.equal(config.KP_PDF_RENDERER_MODE, "v5");
assert.equal(config.KP_PDF_QUALITY_GATE_MODE, "enforce");
assert.equal(config.KP_DISABLE_WEB_RESEARCH, "1");
assert.ok((await fs.stat(path.join(AGENT_ROOT, "scripts", "kpi_pdf_client.mjs"))).isFile());
assert.ok((await fs.stat(path.join(AGENT_ROOT, "schemas", "kp", "request-context-v1.schema.json"))).isFile());
const manifest = JSON.parse(await fs.readFile(path.join(AGENT_ROOT, "engine-manifest.json"), "utf8"));
assert.ok(manifest.files.length >= 50);
const normalizedProfile = normalizeProfileContrast({
  canvas: {
    mode: "light",
    background: "#FFFFFF",
    surface1: "#0D47A1",
    surface2: "#EEF2F8",
    textPrimary: "#0D47A1",
    textSecondary: "#000000",
  },
});
assert.equal(normalizedProfile.canvas.surface1, "#F5F7FA");
assert.equal(normalizedProfile.canvas.textPrimary, "#0D47A1");
console.log("Standalone KP agent unit checks PASS");
