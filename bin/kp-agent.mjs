#!/usr/bin/env node
import { generateProposal } from "../src/agent.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.prompt) {
  console.error("Usage: kp-agent --prompt <text> [--reference <path>] [--output <pdf>] [--locale uz-Latn|ru-RU|en] [--json]");
  process.exit(2);
}

try {
  const result = await generateProposal({
    prompt: args.prompt,
    referencePaths: args.reference,
    outputPath: args.output,
    locale: args.locale,
  }, {
    onProgress: async (message) => {
      if (!args.json) console.error(message);
    },
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`PDF: ${result.documentPath}\nQA: ${result.qaStatus}\nPages: ${result.pageCount}\nRequest: ${result.requestId}`);
} catch (error) {
  console.error(`${error.code || "KP_AGENT_FAILED"}: ${error.message || error}`);
  process.exit(1);
}

function parseArgs(values) {
  const output = { prompt: "", reference: [], output: "", locale: "uz-Latn", json: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--json") output.json = true;
    else if (value === "--reference") output.reference.push(values[++index]);
    else if (value === "--prompt") output.prompt = values[++index];
    else if (value === "--output") output.output = values[++index];
    else if (value === "--locale") output.locale = values[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return output;
}
