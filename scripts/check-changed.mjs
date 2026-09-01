import { resolve } from "node:path";

import { gitChangedPaths, loadSystemModel, planForPaths, repositoryRoot } from "./lib/system-model.mjs";

function parseArguments(args) {
  const options = { json: false, base: null, claim: null, paths: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") options.json = true;
    else if (["--base", "--claim", "--paths"].includes(argument)) {
      const value = args[index += 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--base") options.base = value;
      else if (argument === "--claim") options.claim = value;
      else options.paths.push(...value.split(",").filter(Boolean));
    } else throw new Error(`unknown check:changed argument: ${argument}`);
  }
  if (options.base && options.paths.length) throw new Error("--base and --paths are mutually exclusive");
  return options;
}

export async function checkChanged(args = process.argv.slice(2), { root = repositoryRoot } = {}) {
  const options = parseArguments(args);
  const model = await loadSystemModel({ root });
  const paths = options.paths.length ? options.paths : await gitChangedPaths({ root, base: options.base });
  return { options, plan: planForPaths(model, paths, { claim: options.claim }) };
}

function renderHuman(plan) {
  const lines = [
    `Changed paths (${plan.paths.length}): ${plan.paths.length ? plan.paths.join(", ") : "none"}`,
    `Components: ${plan.components.length ? plan.components.join(", ") : "none"}`,
    `Authority boundaries: ${plan.authority_boundaries.length ? plan.authority_boundaries.join(", ") : "none"}`,
    `Release-sensitive: ${plan.release_sensitive ? "yes" : "no"}`,
    "Commands:"
  ];
  for (const command of plan.commands) lines.push(`  * ${command}`);
  lines.push(`Proof classes: ${plan.proof_classes.length ? plan.proof_classes.join(", ") : "none"}`);
  if (plan.documentation_refresh.length) lines.push(`Documentation refresh: ${plan.documentation_refresh.join(", ")}`);
  if (plan.unmatched_paths.length) lines.push(`Unmatched paths: ${plan.unmatched_paths.join(", ")}`);
  return lines.join("\n");
}

export async function runCheckChangedCli(args = process.argv.slice(2), logger = console) {
  const { options, plan } = await checkChanged(args);
  logger.log(options.json ? JSON.stringify(plan, null, 2) : renderHuman(plan));
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  runCheckChangedCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
