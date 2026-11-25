import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

// One entry-guard convention for every CLI in scripts/. Comparing against
// `new URL(import.meta.url).pathname` silently fails on a checkout path that needs
// percent-encoding (a space, for instance), so the CLI never runs and the process exits 0
// having printed nothing -- indistinguishable from "there was nothing to report".
export function isMainModule(importMetaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  return resolve(argvPath) === fileURLToPath(importMetaUrl);
}
