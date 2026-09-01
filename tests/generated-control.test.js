import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ciImpactPath,
  generateSystemViews,
  renderCiImpact,
  renderTaskRoutes,
  runGenerateSystemViewsCli,
  taskRoutesPath
} from "../scripts/generate-system-views.mjs";
import { loadSystemModel, repositoryRoot } from "../scripts/lib/system-model.mjs";
import { reportVerifyChangedCliFailure, selectChangedPhases, verifyChanged } from "../scripts/verify-changed.mjs";

test("human task routes and CI impact data compile deterministically from one descriptor", async () => {
  const model = await loadSystemModel();
  const [taskRoutes, ciImpact] = await Promise.all([
    readFile(new URL(`../${taskRoutesPath}`, import.meta.url), "utf8"),
    readFile(new URL(`../${ciImpactPath}`, import.meta.url), "utf8")
  ]);
  assert.equal(taskRoutes, renderTaskRoutes(model));
  assert.equal(ciImpact, renderCiImpact(model));
  assert.deepEqual((await generateSystemViews({ check: true })).changed, []);
  assert.deepEqual(JSON.parse(ciImpact).rules.map(({ id }) => id), model.impact_rules.map(({ id }) => id));
  const sparse = structuredClone(model);
  sparse.impact_rules = [{ ...sparse.impact_rules[0], paths: [], components: [], commands: [], proof_classes: [] }];
  assert.match(renderTaskRoutes(sparse), /\| None \| None \| None \| None \|/);
  const messages = [];
  await runGenerateSystemViewsCli(["--check"], { log: (message) => messages.push(message) });
  assert.match(messages[0], /current/);
  await assert.rejects(() => runGenerateSystemViewsCli(["--bad"]), /usage/);
});

test("generated controls create missing views, become idempotent, and fail closed on drift", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bounder-generated-controls-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    mkdir(join(root, "system"), { recursive: true }),
    mkdir(join(root, "_wiki", "generated"), { recursive: true }),
    mkdir(join(root, ".github", "generated"), { recursive: true })
  ]);
  await Promise.all([
    cp(new URL("../system/bounder-system.v1.json", import.meta.url), join(root, "system", "bounder-system.v1.json")),
    cp(new URL("../system/bounder-system.v1.schema.json", import.meta.url), join(root, "system", "bounder-system.v1.schema.json")),
    cp(new URL("../package.json", import.meta.url), join(root, "package.json"))
  ]);
  const created = await generateSystemViews({ root });
  assert.deepEqual(created.changed, [taskRoutesPath, ciImpactPath]);
  assert.deepEqual((await generateSystemViews({ root, check: true })).changed, []);
  await writeFile(join(root, taskRoutesPath), "stale\n");
  await assert.rejects(() => generateSystemViews({ root, check: true }), /stale.*task-routes/);
  assert.deepEqual((await generateSystemViews({ root })).changed, [taskRoutesPath]);
});

test("changed-path execution uses descriptor commands and never recursively invokes aggregate verify", async () => {
  const model = await loadSystemModel();
  const focused = selectChangedPhases(model, { commands: ["unit", "unit_coverage", "docs_check"] });
  assert.equal(focused.phases.some(({ id }) => id === "unit"), false);
  assert.equal(focused.phases.some(({ id }) => id === "unit-coverage"), true);

  const aggregate = selectChangedPhases(model, { commands: ["verify", "producer_derivation"] }, { producerRoot: "" });
  assert.equal(aggregate.phases.some(({ command, args }) => command === "npm" && args.includes("verify")), false);
  assert.ok(aggregate.skipped.some(({ command }) => command === "producer_derivation"));
  const aggregateWithProducer = selectChangedPhases(model, { commands: ["verify", "producer_derivation"] }, { producerRoot: "/producer" });
  assert.equal(aggregateWithProducer.phases[1].id, "producer-derivation");
  const focusedProducer = selectChangedPhases(model, { commands: ["producer_derivation"] }, { producerRoot: "/producer" });
  assert.deepEqual(focusedProducer.phases[0].args.slice(-3), ["--", "--producer-root", "/producer"]);

  const result = await verifyChanged(["--paths", "CLAUDE.md"], {
    root: repositoryRoot,
    logger: { log() {} },
    phaseRunner: async () => ({ exit_code: 0, signal: null, timed_out: false, duration_ms: 1, stdout: "ok", stderr: "" })
  });
  assert.equal(result.receipt.success, true);
  assert.ok(result.receipt.plan.components.includes("architecture_knowledge"));

  await assert.rejects(() => verifyChanged(["--paths", "schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json", "--require-producer"], {
    root: repositoryRoot,
    producerRoot: "",
    logger: { log() {} }
  }), /forbids skipping/);

  let now = Date.parse("2026-09-01T13:00:00Z");
  await assert.rejects(() => verifyChanged(["--paths", "CLAUDE.md"], {
    root: repositoryRoot,
    clock: () => now += 1,
    logger: { log() {} },
    phaseRunner: async () => ({ exit_code: 2, signal: null, timed_out: false, duration_ms: 2, stdout: "", stderr: "failed" })
  }), /changed-path verification failed/);
  const failed = JSON.parse(await readFile(new URL("../artifacts/changed-verification/latest.json", import.meta.url), "utf8"));
  assert.equal(failed.success, false);
  assert.equal(failed.phases.length, 1);
  assert.ok(failed.skipped.some(({ reason }) => /earlier selected command failed/.test(reason)));

  const priorExitCode = process.exitCode;
  const errors = [];
  reportVerifyChangedCliFailure(new Error("reported"), { error: (message) => errors.push(message) });
  assert.deepEqual(errors, ["reported"]);
  process.exitCode = priorExitCode;
});
