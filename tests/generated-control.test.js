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

test("changed-path execution uses descriptor commands and never recursively invokes aggregate verify", async (t) => {
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

  // Receipts go to a scratch directory: `root` stays the repository because the selection logic
  // under test reads the descriptor from it, but a unit test must not write evidence into the
  // working tree that a reader could mistake for a real changed-path verification.
  const receipts = await mkdtemp(join(tmpdir(), "bounder-changed-receipts-"));
  t.after(() => rm(receipts, { recursive: true, force: true }));
  const result = await verifyChanged(["--paths", "CLAUDE.md"], {
    root: repositoryRoot,
    outputRoot: join(receipts, "pass"),
    logger: { log() {} },
    phaseRunner: async () => ({ exit_code: 0, signal: null, timed_out: false, duration_ms: 1, stdout: "ok", stderr: "" })
  });
  assert.equal(result.receipt.success, true);
  assert.ok(result.receipt.plan.components.includes("architecture_knowledge"));

  await assert.rejects(() => verifyChanged(["--paths", "schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json", "--require-producer"], {
    root: repositoryRoot,
    outputRoot: join(receipts, "require-producer"),
    producerRoot: "",
    logger: { log() {} }
  }), /forbids skipping/);

  let now = Date.parse("2026-09-01T13:00:00Z");
  const failingRoot = join(receipts, "fail");
  const reportedFailures = [];
  await assert.rejects(() => verifyChanged(["--paths", "CLAUDE.md"], {
    root: repositoryRoot,
    outputRoot: failingRoot,
    clock: () => now += 1,
    logger: { log() {}, error: (message) => reportedFailures.push(message) },
    phaseRunner: async () => ({ exit_code: 2, signal: null, timed_out: false, duration_ms: 2, stdout: "", stderr: "failed" })
  }), /changed-path verification failed/);
  assert.equal(reportedFailures.length, 1, "the failed command surfaces its log tail on the console");
  // An empty stdout leaves the log's leading line blank before the stderr marker.
  assert.match(reportedFailures[0], /^verify:changed:[a-z-]+ failed; last 3 log line\(s\):\n\n\[stderr\]\nfailed$/);
  const failed = JSON.parse(await readFile(join(failingRoot, "latest.json"), "utf8"));
  assert.equal(failed.success, false);
  assert.equal(failed.phases.length, 1);
  assert.ok(failed.skipped.some(({ reason }) => /earlier selected command failed/.test(reason)));

  const priorExitCode = process.exitCode;
  const errors = [];
  reportVerifyChangedCliFailure(new Error("reported"), { error: (message) => errors.push(message) });
  assert.deepEqual(errors, ["reported"]);
  process.exitCode = priorExitCode;
});
