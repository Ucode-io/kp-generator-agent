import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const targetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(process.argv[2] || process.env.KP_ENGINE_SOURCE || "../Udevs AI Assistant");
const entryPoints = [
  "scripts/kpi_pdf_client.mjs",
  "scripts/kp_reference_runtime.mjs",
  "scripts/kp_reference_store.mjs",
  "scripts/kp_reference_contracts.mjs",
];

const files = await localDependencyGraph(sourceRoot, entryPoints);
await fs.rm(path.join(targetRoot, "scripts"), { recursive: true, force: true });
await fs.rm(path.join(targetRoot, "schemas", "kp"), { recursive: true, force: true });
for (const relativePath of files) await copy(relativePath);
await copyTree("schemas/kp");
await removeLocalProjectCatalog(path.join(targetRoot, "scripts", "kpi_pdf_client.mjs"));
await makePythonFallbackPortable(files);
await fs.mkdir(path.join(targetRoot, "data"), { recursive: true });

const manifestFiles = [
  ...files,
  ...await listFiles(path.join(targetRoot, "schemas", "kp"), targetRoot),
].sort();
const manifest = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  sourceName: path.basename(sourceRoot),
  entryPoints,
  files: [],
};
for (const relativePath of manifestFiles) {
  const data = await fs.readFile(path.join(targetRoot, relativePath));
  manifest.files.push({ relativePath, sha256: crypto.createHash("sha256").update(data).digest("hex"), sizeBytes: data.length });
}
await fs.writeFile(path.join(targetRoot, "engine-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Vendored ${files.length} engine modules and ${manifest.files.length - files.length} schemas into ${targetRoot}`);

async function localDependencyGraph(root, starts) {
  const seen = new Set();
  const queue = [...starts];
  while (queue.length) {
    const relativePath = queue.shift();
    if (seen.has(relativePath)) continue;
    const absolutePath = path.join(root, relativePath);
    const source = await fs.readFile(absolutePath, "utf8");
    seen.add(relativePath);
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"]([^'\"]+)['\"]/g)) {
      if (!match[1].startsWith(".")) continue;
      let dependency = path.normalize(path.join(path.dirname(relativePath), match[1]));
      if (!path.extname(dependency)) dependency += ".mjs";
      queue.push(dependency);
    }
  }
  return [...seen].sort();
}

async function copy(relativePath) {
  const source = path.join(sourceRoot, relativePath);
  const target = path.join(targetRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function copyTree(relativeDirectory) {
  const sourceDirectory = path.join(sourceRoot, relativeDirectory);
  for (const entry of await fs.readdir(sourceDirectory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) await copyTree(relativePath);
    else if (entry.isFile()) await copy(relativePath);
  }
}

async function removeLocalProjectCatalog(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const portable = source.replace(/const projectSources = \[[\s\S]*?\n\];\n\nlet cachedSummary;/, "const projectSources = [];\n\nlet cachedSummary;");
  if (portable === source) throw new Error("Could not remove the local projectSources catalog from vendored engine");
  await fs.writeFile(filePath, portable, "utf8");
}

async function makePythonFallbackPortable(relativePaths) {
  for (const relativePath of relativePaths) {
    const filePath = path.join(targetRoot, relativePath);
    const source = await fs.readFile(filePath, "utf8");
    const portable = source.replace(/"\/Users\/[^"\n]+\/dependencies\/python\/bin\/python3"/g, '"python3"');
    if (portable !== source) await fs.writeFile(filePath, portable, "utf8");
  }
}

async function listFiles(directory, relativeRoot) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(absolutePath, relativeRoot));
    else if (entry.isFile()) output.push(path.relative(relativeRoot, absolutePath));
  }
  return output;
}
