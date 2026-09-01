import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  descriptorDirectory,
  descriptorPath,
  gitChangedPaths,
  loadSystemModel,
  matchesPathPattern,
  pathPatternToRegExp,
  planForPaths,
  relativeFromRoot,
  repositoryRoot,
  validateSystemModel
} from "../scripts/lib/system-model.mjs";

const [descriptor, schema, packageJson] = await Promise.all([
  readFile(new URL("../system/bounder-system.v1.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../system/bounder-system.v1.schema.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse)
]);
const clone = structuredClone;

async function validate(model, overrides = {}) {
  return validateSystemModel(model, { root: repositoryRoot, schema, packageJson, requirePaths: false, ...overrides });
}

test("canonical system descriptor validates every role, component, artifact, command, proof, impact, path, and budget edge", async () => {
  const model = await loadSystemModel();
  assert.equal(model.schema_version, "bounder-system/v1");
  assert.equal(model.components.some(({ id }) => id === "fleet_observability_reference"), true);
  assert.equal(model.proof_classes.some(({ id }) => id === "observability_performance"), true);
  assert.equal(Object.isFrozen(model), true);
  assert.equal((await validate(clone(descriptor))).components.size, descriptor.components.length);
  assert.equal(descriptorPath, "system/bounder-system.v1.json");
  assert.match(descriptorDirectory(), /system$/);
  assert.equal(relativeFromRoot(repositoryRoot, new URL("../package.json", import.meta.url).pathname), "package.json");
});

test("descriptor semantic validation rejects duplicate ids, unknown references, cycles, uncovered components, invalid budgets, and missing package commands", async () => {
  const cases = [
    ["duplicate", (model) => model.roles.push(clone(model.roles[0])), /duplicate role/],
    ["unknown role", (model) => { model.components[0].role = "missing"; }, /unknown id/],
    ["unknown artifact", (model) => { model.components[0].inputs = ["missing"]; }, /unknown id/],
    ["self cycle", (model) => { model.components[0].depends_on = [model.components[0].id]; }, /depends on itself/],
    ["dependency cycle", (model) => { model.components[0].depends_on = [model.components[1].id]; model.components[1].depends_on = [model.components[0].id]; }, /cycle/],
    ["uncovered", (model) => { model.components.push({ ...clone(model.components.at(-1)), id: "uncovered_component", source_paths: ["package.json"] }); }, /no impact rule/],
    ["interval", (model) => { model.budgets.attention_interval_ms = 70_000; }, /out of order/],
    ["expiry", (model) => { model.budgets.stable_interval_ms = 90_000; }, /expire/],
    ["payload", (model) => { model.budgets.event_max_bytes = 20_000; }, /payload budgets/],
    ["missing script", (model) => { model.commands[0].argv = ["npm", "run", "missing"]; }, /missing package script/]
  ];
  for (const [name, mutate, pattern] of cases) {
    const model = clone(descriptor);
    mutate(model);
    await assert.rejects(() => validate(model), pattern, name);
  }
});

test("path matching is anchored and changed-path plans accumulate overlapping rules in descriptor order", () => {
  assert.equal(matchesPathPattern("schemas/a.json", "schemas/**"), true);
  assert.equal(matchesPathPattern("nested/a.html", "*.html"), false);
  assert.equal(matchesPathPattern("index.html", "*.html"), true);
  assert.equal(matchesPathPattern("runtime/observability/x.js", "runtime/observability/**"), true);
  assert.throws(() => pathPatternToRegExp("../outside"), /unsafe/);
  const plan = planForPaths(descriptor, ["runtime/observability/guardian-fleet-state.js"], { claim: "runtime_observability" });
  assert.deepEqual(plan.components, ["guardian_observability_reference", "fleet_observability_reference"]);
  assert.ok(plan.commands.includes("observability_test"));
  assert.equal(plan.commands.includes("browser"), false);
  assert.equal(plan.release_sensitive, false);
  assert.deepEqual(plan.unmatched_paths, []);
  const contractPlan = planForPaths(descriptor, ["schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json"]);
  assert.ok(contractPlan.commands.includes("build"));
  assert.ok(contractPlan.commands.includes("browser"));
  assert.equal(contractPlan.release_sensitive, true);
  const unmatched = planForPaths(descriptor, ["unknown.file"]);
  assert.deepEqual(unmatched.unmatched_paths, ["unknown.file"]);
  assert.throws(() => planForPaths(descriptor, ["package.json"], { claim: "missing" }), /unknown proof claim/);
  assert.throws(() => planForPaths(descriptor, [null]), /invalid/);
});

test("working-tree changed-path discovery is read only and includes the active system descriptor", async () => {
  const paths = await gitChangedPaths();
  assert.ok(paths.includes("system/bounder-system.v1.json"));
  const againstHead = await gitChangedPaths({ base: "HEAD" });
  assert.deepEqual(againstHead, []);
});
