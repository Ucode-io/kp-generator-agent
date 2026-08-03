import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateProposal } from "../src/agent.mjs";
import { buildProductDeliveryInventory } from "../scripts/kp_product_map_model.mjs";
import { primaryFlowSegmentCount, roadmapWorkstreamSegmentCount } from "../scripts/kp_visualization_planner.mjs";
import { resolvePublishedPrototype } from "../scripts/kp_app_prototype_publisher.mjs";

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
assert.ok(result.prototype.url.startsWith("https://kp.udevs.io/p/"));
assert.equal(result.prototypeUrl, result.prototype.url);
assert.equal(result.prototype.qaStatus, "PASS");
assert.equal(result.prototype.screenCount, 57);
assert.ok((await fs.stat(result.prototype.path)).size > 20_000);
assert.ok(result.html.includes(result.prototype.url));
assert.ok(result.html.includes('<meta name="kp:prototype-url-base64"'));
const prototypeRecord = JSON.parse(await fs.readFile(path.join(result.workspace, "model", "app-prototype-record.json"), "utf8"));
assert.equal(prototypeRecord.publicUrl, result.prototype.url);
assert.equal(prototypeRecord.relativePath, "final/prototype/index.html");
assert.equal(prototypeRecord.qaStatus, "PASS");
const prototypeSpec = JSON.parse(await fs.readFile(path.join(result.workspace, "contracts", "app-prototype-spec.json"), "utf8"));
assert.equal(prototypeSpec.project.type, "ecommerce");
assert.ok(prototypeSpec.screens.some((screen) => screen.id === "admin_catalog"));
assert.equal(prototypeSpec.screens.some((screen) => screen.id === "seller_workspace"), false);
assert.equal(prototypeSpec.screens.length, result.prototype.screenCount);
assert.equal(new Set(prototypeSpec.navigation.flatMap((group) => group.screenIds)).size, prototypeSpec.screens.length);
const prototypeQa = JSON.parse(await fs.readFile(path.join(result.workspace, "qa", "app-prototype-qa.json"), "utf8"));
assert.equal(prototypeQa.status, "PASS");
const publicId = result.prototype.url.match(/\/p\/([^/]+)\//)?.[1];
assert.ok(publicId);
const publishedPrototype = await resolvePublishedPrototype(publicId, { outputRoot: path.dirname(result.workspace) });
assert.equal(publishedPrototype.htmlPath, result.prototype.path);
assert.equal((result.html.match(/<section[^>]+data-page-composition="light"/g) || []).length, result.pageCount);
assert.ok(!/<section[^>]+data-page-composition="split"/.test(result.html));
assert.ok(result.html.includes('data-page-composition="light"'));
assert.ok(result.html.includes('.page[data-page-composition="dark"],.kp-page[data-page-composition="dark"]{'));
assert.ok(result.html.includes("background-udevs-screenshot"));
assert.ok(result.html.includes("data:image/png;base64,"));
assert.ok(!result.html.includes(".page:nth-child(even),.kp-page:nth-child(even)"));
const presentationPlan = JSON.parse(await fs.readFile(path.join(result.workspace, "contracts", "presentation-plan.json"), "utf8"));
const semanticModel = JSON.parse(await fs.readFile(path.join(result.workspace, "contracts", "semantic-model.json"), "utf8"));
const deliveryInventory = buildProductDeliveryInventory(semanticModel);
const expectedFunctionPages = Math.max(1, Math.ceil(deliveryInventory.length / 14));
const expectedPrimaryFlowPages = semanticModel.processes?.length ? primaryFlowSegmentCount(semanticModel) : 0;
const expectedRoadmapPages = roadmapWorkstreamSegmentCount(semanticModel);
const pageKinds = presentationPlan.pages.map((page) => page.kind);
assert.equal(pageKinds.filter((kind) => kind === "function_price").length, expectedFunctionPages);
assert.equal(pageKinds.filter((kind) => kind === "primary_flow").length, expectedPrimaryFlowPages);
assert.equal(pageKinds.filter((kind) => kind === "roadmap").length, expectedRoadmapPages);
assert.equal(pageKinds.filter((kind) => kind === "payments").length, 1);
assert.ok(pageKinds.indexOf("function_price") > pageKinds.lastIndexOf("product_map"));
assert.ok(pageKinds.indexOf("payments") > pageKinds.lastIndexOf("roadmap"));
assert.equal((result.html.match(/<section[^>]+data-page-kind="function_price"/g) || []).length, expectedFunctionPages);
assert.equal((result.html.match(/<section[^>]+data-page-kind="primary_flow"/g) || []).length, expectedPrimaryFlowPages);
assert.equal((result.html.match(/<section[^>]+data-page-kind="roadmap"/g) || []).length, expectedRoadmapPages);
assert.equal((result.html.match(/<section[^>]+data-page-kind="payments"/g) || []).length, 1);
const primaryFlowPages = presentationPlan.pages.filter((page) => page.kind === "primary_flow");
const primaryFlowSpecs = await Promise.all(primaryFlowPages.map((page) => fs.readFile(
  path.join(result.workspace, "contracts", "visualization-specs", `${page.visualizationSpecId}.json`),
  "utf8",
).then(JSON.parse)));
assert.ok(primaryFlowSpecs.every((spec) => spec.segmentCount === expectedPrimaryFlowPages));
assert.equal((result.html.match(/data-viz-kind="bpmn"/g) || []).length, expectedPrimaryFlowPages);
assert.equal((result.html.match(/data-viz-kind="bpmn"[^>]+data-viz-density="dense"/g) || []).length, 0);
assert.equal(semanticModel.actors.length, 0);
assert.equal(semanticModel.processes.length, 0);
for (const row of deliveryInventory) {
  const escaped = row.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.equal((result.html.match(new RegExp('data-node-id="' + escaped + '"', "g")) || []).length, 3);
}
assert.ok(result.html.includes("Funksional bloklar va muddatlar"));
assert.ok(result.html.includes("To'lov jadvali taqdim etilmagan."));
console.log(`Standalone KP agent PDF smoke PASS: ${outputPath}`);
