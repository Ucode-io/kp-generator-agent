import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function enterAgentRoot() {
  if (process.cwd() !== AGENT_ROOT) process.chdir(AGENT_ROOT);
  return AGENT_ROOT;
}
