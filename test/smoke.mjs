import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateProposal } from "../src/agent.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "standalone-kp-agent-"));
const outputPath = path.join(directory, "proposal.pdf");
const result = await generateProposal({
  prompt: "Internet magazin uchun KP. 3 oy. Budjet hali tasdiqlanmagan.",
  outputPath,
  locale: "uz-Latn",
});
assert.equal(result.ok, true);
assert.equal(result.qaStatus, "PASS");
assert.ok(result.pageCount >= 2);
assert.ok((await fs.stat(outputPath)).size > 80_000);
assert.ok(result.sourceDocumentPath.endsWith(".pdf"));
const proposalRecord = JSON.parse(await fs.readFile(path.join(result.workspace, "model", "proposal-record.json"), "utf8"));
assert.equal(proposalRecord.state, "ready");
assert.equal(proposalRecord.artifact.relativePath, "final/proposal.pdf");
assert.equal(proposalRecord.artifact.pageCount, result.pageCount);
assert.equal(result.theme.source.kind, "udevs_static");
assert.equal(result.theme.palette.primary, "#1A54FE");
assert.equal(result.theme.palette.secondary, "#0A0A0F");
assert.equal(result.theme.palette.accent, result.theme.palette.secondary);
assert.equal(result.theme.palette.background, "#FFFFFF");
assert.ok(result.html.includes("--kp-brand-primary:#1A54FE"));
assert.ok(result.html.includes("--kp-brand-secondary:#0A0A0F"));
assert.ok(result.html.includes("--kp-brand-accent:#0A0A0F"));
assert.equal((result.html.match(/<section[^>]+data-page-composition="light"/g) || []).length, result.pageCount);
assert.ok(!/<section[^>]+data-page-composition="split"/.test(result.html));
assert.ok(result.html.includes('data-page-composition="light"'));
assert.ok(result.html.includes('.page[data-page-composition="dark"],.kp-page[data-page-composition="dark"]{'));
assert.ok(result.html.includes("background-udevs-screenshot"));
assert.ok(result.html.includes("data:image/png;base64,"));
assert.ok(!result.html.includes(".page:nth-child(even),.kp-page:nth-child(even)"));
console.log(`Standalone KP agent PDF smoke PASS: ${outputPath}`);
