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
assert.ok((await fs.stat(outputPath)).size > 10_000);
console.log(`Standalone KP agent PDF smoke PASS: ${outputPath}`);
