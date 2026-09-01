import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const execFileAsync = promisify(execFile);
export const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const descriptorPath = "system/bounder-system.v1.json";
export const descriptorSchemaPath = "system/bounder-system.v1.schema.json";

const compare = (left, right) => left.localeCompare(right, "en");

function uniqueById(records, label) {
  const map = new Map();
  for (const record of records) {
    if (map.has(record.id)) throw new Error(`duplicate ${label} id: ${record.id}`);
    map.set(record.id, record);
  }
  return map;
}

function requireReferences(values, index, label) {
  for (const value of values) {
    if (!index.has(value)) throw new Error(`${label} references unknown id: ${value}`);
  }
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function pathPatternToRegExp(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.startsWith("/") || pattern.includes("\\") || /(^|\/)\.\.(\/|$)/.test(pattern)) {
    throw new Error(`unsafe path pattern: ${pattern}`);
  }
  const token = "\u0000DOUBLE_STAR\u0000";
  const expression = escapeRegex(pattern)
    .replaceAll("**", token)
    .replaceAll("*", "[^/]*")
    .replaceAll(token, ".*");
  return new RegExp(`^${expression}$`, "u");
}

export function matchesPathPattern(path, pattern) {
  return pathPatternToRegExp(pattern).test(path);
}

async function repositoryPaths(root) {
  try {
    const { stdout } = await execFileAsync("/usr/bin/git", ["--no-optional-locks", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
    });
    return stdout.toString("utf8").split("\0").filter(Boolean).sort(compare);
  } catch (error) {
    throw new Error(`cannot inventory repository paths: ${error.message}`);
  }
}

function assertAcyclic(components) {
  const byId = new Map(components.map((component) => [component.id, component]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail) => {
    if (visiting.has(id)) throw new Error(`component dependency cycle: ${[...trail, id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const component of components) visit(component.id, []);
}

async function assertDeclaredPaths(model, root, allPaths) {
  const checks = [];
  for (const component of model.components) {
    for (const path of [...component.source_paths, ...component.test_paths]) checks.push([path, `component ${component.id}`]);
  }
  for (const path of [...model.documentation.entrypoints, model.documentation.wiki_index, model.documentation.wiki_log]) {
    checks.push([path, "documentation"]);
  }
  for (const [pattern, owner] of checks) {
    pathPatternToRegExp(pattern);
    if (pattern.includes("*")) {
      if (!allPaths.some((path) => matchesPathPattern(path, pattern))) throw new Error(`${owner} path pattern matches nothing: ${pattern}`);
    } else {
      try {
        await stat(resolve(root, pattern));
      } catch {
        throw new Error(`${owner} path does not exist: ${pattern}`);
      }
    }
  }
}

function validateBudgets(budgets) {
  if (!(budgets.attention_interval_ms <= budgets.healthy_interval_ms && budgets.healthy_interval_ms <= budgets.stable_interval_ms)) {
    throw new Error("observability heartbeat budgets are out of order");
  }
  if (Math.ceil(budgets.stable_interval_ms * (1 + budgets.jitter_fraction)) >= budgets.heartbeat_validity_ms) {
    throw new Error("observability stable heartbeat can expire before its next scheduled report");
  }
  if (!(budgets.event_max_bytes <= budgets.heartbeat_max_bytes && budgets.heartbeat_max_bytes <= budgets.snapshot_max_bytes)) {
    throw new Error("observability payload budgets are out of order");
  }
}

function validateCommandScripts(model, packageJson) {
  for (const command of model.commands) {
    if (command.argv[0] !== "npm") continue;
    const script = command.argv[1] === "run" ? command.argv[2] : command.argv[1] === "test" ? "test" : null;
    if (script && !Object.hasOwn(packageJson.scripts || {}, script)) {
      throw new Error(`descriptor command ${command.id} references missing package script: ${script}`);
    }
  }
}

export async function validateSystemModel(model, {
  root = repositoryRoot,
  schema,
  requirePaths = true,
  packageJson
} = {}) {
  const loadedSchema = schema || JSON.parse(await readFile(resolve(root, descriptorSchemaPath), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(loadedSchema);
  if (!validate(model)) {
    const details = validate.errors.map(({ instancePath, message }) => `${instancePath || "/"} ${message}`).join("; ");
    throw new Error(`system descriptor schema validation failed: ${details}`);
  }

  const roles = uniqueById(model.roles, "role");
  const components = uniqueById(model.components, "component");
  const artifacts = uniqueById(model.artifacts, "artifact");
  const commands = uniqueById(model.commands, "command");
  const proofs = uniqueById(model.proof_classes, "proof class");
  uniqueById(model.impact_rules, "impact rule");

  for (const component of model.components) {
    requireReferences([component.role], roles, `component ${component.id} role`);
    requireReferences(component.inputs, artifacts, `component ${component.id} input`);
    requireReferences(component.outputs, artifacts, `component ${component.id} output`);
    requireReferences(component.proof_classes, proofs, `component ${component.id} proof`);
    requireReferences(component.depends_on, components, `component ${component.id} dependency`);
    if (component.depends_on.includes(component.id)) throw new Error(`component depends on itself: ${component.id}`);
  }
  assertAcyclic(model.components);

  for (const artifact of model.artifacts) {
    requireReferences([artifact.producer_component], components, `artifact ${artifact.id} producer`);
    requireReferences([artifact.canonical_owner], roles, `artifact ${artifact.id} owner`);
    requireReferences(artifact.input_inventory, artifacts, `artifact ${artifact.id} input`);
    requireReferences(artifact.verification, proofs, `artifact ${artifact.id} verification`);
  }
  for (const command of model.commands) requireReferences(command.proof_classes, proofs, `command ${command.id} proof`);
  for (const proof of model.proof_classes) {
    requireReferences(proof.required_commands, commands, `proof ${proof.id} command`);
    requireReferences(proof.required_artifacts, artifacts, `proof ${proof.id} artifact`);
  }
  const impactedComponents = new Set();
  for (const rule of model.impact_rules) {
    for (const pattern of rule.paths) pathPatternToRegExp(pattern);
    requireReferences(rule.components, components, `impact rule ${rule.id} component`);
    requireReferences(rule.commands, commands, `impact rule ${rule.id} command`);
    requireReferences(rule.proof_classes, proofs, `impact rule ${rule.id} proof`);
    rule.components.forEach((id) => impactedComponents.add(id));
  }
  for (const component of model.components) {
    if (component.source_paths.length > 0 && !impactedComponents.has(component.id)) {
      throw new Error(`local component has no impact rule: ${component.id}`);
    }
  }
  validateBudgets(model.budgets);

  const loadedPackage = packageJson || JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  validateCommandScripts(model, loadedPackage);
  if (requirePaths) await assertDeclaredPaths(model, root, await repositoryPaths(root));
  return Object.freeze({ roles, components, artifacts, commands, proofs });
}

export async function loadSystemModel({ root = repositoryRoot, requirePaths = true } = {}) {
  const [descriptorSource, schemaSource, packageSource] = await Promise.all([
    readFile(resolve(root, descriptorPath), "utf8"),
    readFile(resolve(root, descriptorSchemaPath), "utf8"),
    readFile(resolve(root, "package.json"), "utf8")
  ]);
  const model = JSON.parse(descriptorSource);
  await validateSystemModel(model, {
    root,
    schema: JSON.parse(schemaSource),
    requirePaths,
    packageJson: JSON.parse(packageSource)
  });
  return deepFreeze(model);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function planForPaths(model, paths, { claim = null } = {}) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string" || path.length === 0)) {
    throw new Error("changed paths are invalid");
  }
  const normalizedPaths = [...new Set(paths)].sort(compare);
  const matchedRules = model.impact_rules.filter((rule) => normalizedPaths.some((path) => rule.paths.some((pattern) => matchesPathPattern(path, pattern))));
  const collectOrdered = (records, ids) => records.filter(({ id }) => ids.has(id)).map(({ id }) => id);
  const componentIds = new Set(matchedRules.flatMap((rule) => rule.components));
  const commandIds = new Set(matchedRules.flatMap((rule) => rule.commands));
  const proofIds = new Set(matchedRules.flatMap((rule) => rule.proof_classes));
  if (claim) {
    const proof = model.proof_classes.find(({ id }) => id === claim);
    if (!proof) throw new Error(`unknown proof claim: ${claim}`);
    proofIds.add(proof.id);
    proof.required_commands.forEach((id) => commandIds.add(id));
  }
  return deepFreeze({
    paths: normalizedPaths,
    matched_rules: matchedRules.map(({ id, reason }) => ({ id, reason })),
    components: collectOrdered(model.components, componentIds),
    commands: collectOrdered(model.commands, commandIds),
    proof_classes: collectOrdered(model.proof_classes, proofIds),
    authority_boundaries: [...new Set(matchedRules.flatMap((rule) => rule.authority_boundaries))].sort(compare),
    release_sensitive: matchedRules.some((rule) => rule.release_sensitive),
    documentation_refresh: [...new Set(matchedRules.flatMap((rule) => rule.documentation_refresh))].sort(compare),
    unmatched_paths: normalizedPaths.filter((path) => !matchedRules.some((rule) => rule.paths.some((pattern) => matchesPathPattern(path, pattern))))
  });
}

export async function gitChangedPaths({ root = repositoryRoot, base = null, gitRunner = execFileAsync } = {}) {
  const args = base
    ? ["--no-optional-locks", "-C", root, "diff", "--name-only", "--diff-filter=ACMRDTUXB", `${base}...HEAD`, "--"]
    : ["--no-optional-locks", "-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"];
  const { stdout } = await gitRunner("/usr/bin/git", args, {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
  });
  if (base) return stdout.toString("utf8").split("\n").filter(Boolean).sort(compare);
  const entries = stdout.toString("utf8").split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status.includes("R") || status.includes("C")) {
      paths.push(path);
      if (entries[index + 1]) paths.push(entries[index += 1]);
    } else paths.push(path);
  }
  return [...new Set(paths)].sort(compare);
}

export function relativeFromRoot(root, path) {
  return relative(resolve(root), resolve(path)).split("\\").join("/");
}

export function descriptorDirectory(root = repositoryRoot) {
  return dirname(resolve(root, descriptorPath));
}
