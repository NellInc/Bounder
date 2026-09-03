import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { checkChanged, runCheckChangedCli } from "../scripts/check-changed.mjs";
import { assertFileLine, checkDocumentation, collectMarkdown, heldClaim, runDocsCheckCli } from "../scripts/docs-check.mjs";
import {
  compareProducerContracts,
  discoverProducer,
  inspectGit,
  inspectSystem,
  renderInspectionHuman,
  repositoryState,
  runInspectCli,
  schemaInventory
} from "../scripts/system-inspect.mjs";
import { runSystemCheck } from "../scripts/validate-system.mjs";
import {
  executeVerificationPhase,
  runVerification,
  runVerifyCli
} from "../scripts/verify.mjs";

const execFileAsync = promisify(execFile);

test("agent inspection and changed-path commands expose compact human and stable JSON views", async () => {
  const inspection = await inspectSystem();
  assert.equal(inspection.version, "bounder-inspection/v1");
  assert.equal(inspection.system_id, "bounder");
  assert.equal(typeof inspection.repository.dirty, "boolean");
  assert.ok(inspection.holds.some((hold) => /producer/i.test(hold)));
  assert.equal(inspection.schemas.identity_collisions.length, 0);
  if (inspection.release.manifest.missing) {
    assert.ok(inspection.release.unpinned_public_schemas.includes("schemas/bounder-evidence-provenance-v1.schema.json"));
    assert.ok(inspection.release.unpinned_public_schemas.includes("schemas/bounder-release-manifest-v2.schema.json"));
  } else {
    assert.deepEqual(inspection.release.unpinned_public_schemas, []);
  }

  const human = [];
  await runInspectCli([], { log: (message) => human.push(message) });
  assert.match(human[0], /Bounder/);
  assert.ok(human[0].split("\n").length < 80);
  const json = [];
  await runInspectCli(["--json"], { log: (message) => json.push(message) });
  assert.equal(JSON.parse(json[0]).version, "bounder-inspection/v1");
  await assert.rejects(() => runInspectCli(["--bad"]), /unknown/);

  const { plan } = await checkChanged(["--paths", "runtime/observability/guardian-fleet-state.js", "--claim", "runtime_observability"]);
  assert.ok(plan.commands.includes("observability_test"));
  const rendered = [];
  await runCheckChangedCli(["--paths", "CLAUDE.md", "--json"], { log: (message) => rendered.push(message) });
  assert.ok(JSON.parse(rendered[0]).components.includes("architecture_knowledge"));
  await assert.rejects(() => checkChanged(["--base", "HEAD", "--paths", "package.json"]), /mutually exclusive/);
  assert.deepEqual((await checkChanged(["--base", "HEAD"])).plan.paths, []);
  await assert.rejects(() => checkChanged(["--paths"]), /requires a value/);
  await assert.rejects(() => checkChanged(["--bad"]), /unknown/);
  const emptyHuman = [];
  await runCheckChangedCli(["--paths", "unknown.file"], { log: (message) => emptyHuman.push(message) });
  assert.match(emptyHuman[0], /Components: none/);
  assert.match(emptyHuman[0], /Unmatched paths: unknown.file/);
});

test("documentation and descriptor CLIs validate the compiled knowledge graph while surfacing exact held claims", async () => {
  const report = await checkDocumentation();
  assert.equal(report.errors.length, 0);
  assert.equal(report.claim_holds, 0);
  assert.equal(report.warnings.length, 0);
  const messages = [];
  const warnings = [];
  await runDocsCheckCli([], { log: (message) => messages.push(message), warn: (message) => warnings.push(message) });
  assert.match(messages[0], /Documentation:/);
  assert.equal(warnings.length, 0);
  const json = [];
  await runDocsCheckCli(["--json"], { log: (message) => json.push(message), warn() {} });
  assert.equal(JSON.parse(json[0]).version, "bounder-docs-check/v1");
  await assert.rejects(() => runDocsCheckCli(["--bad"]), /unknown/);
  const model = await runSystemCheck({ log() {} });
  assert.equal(model.system_id, "bounder");
});

test("documentation checker rejects malformed navigation, citations, chronology, claims, and stale hold registrations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bounder-docs-test-"));
  t.after(async () => { const { rm } = await import("node:fs/promises"); await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, "_wiki", "systems"), { recursive: true });
  await mkdir(join(root, "guides"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "_wiki", "index.md"), "# Index\n"),
    writeFile(join(root, "_wiki", "log.md"), "## [2026-09-01] later\n## [2026-08-31] earlier\n"),
    writeFile(join(root, "_wiki", "systems", "bad.md"), "# Bad\n<!-- wiki:updated = 2099-01-01 -->\n[[bounder:missing]]\n`missing.js:1`\n"),
    writeFile(join(root, "_wiki", "ignore.txt"), "ignored\n"),
    writeFile(join(root, "README.md"), "github.com/NellWatson/Bounder\n"),
    writeFile(join(root, "SECURITY.md"), "safe\n"),
    writeFile(join(root, "guides", "INTEGRATION.md"), "safe\n"),
    writeFile(join(root, "CLAUDE.md"), "safe\n")
  ]);
  const model = {
    documentation: {
      wiki_index: "_wiki/index.md",
      wiki_log: "_wiki/log.md",
      claim_holds: [{ id: "stale", path: "README.md", contains: "does not exist", reason: "test", closing_gate: "test" }]
    }
  };
  await assert.rejects(() => checkDocumentation({ root, model }), /future|missing from|unresolved|missing file|chronological|unheld|must match/);
  assert.deepEqual(await collectMarkdown(join(root, "_wiki")), ["index.md", "log.md", "systems/bad.md"]);
  await assertFileLine(root, "README.md", 1, 1, "test");
  await assert.rejects(() => assertFileLine(root, "../outside", 1, 1, "test"), /unsafe|missing/);
  await assert.rejects(() => assertFileLine(root, "README.md", 2, 1, "test"), /invalid range/);
  assert.equal(heldClaim({ documentation: { claim_holds: [{ path: "README.md", contains: "held text" }] } }, "README.md", "held", "held text"), true);
  assert.equal(heldClaim({ documentation: { claim_holds: [] } }, "README.md", "held", "held text"), false);
});

test("inspection primitives handle clean repositories, missing upstreams, optional Git failures, schema collisions, absent producers, and human fallbacks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bounder-inspect-test-"));
  t.after(async () => { const { rm } = await import("node:fs/promises"); await rm(root, { recursive: true, force: true }); });
  await execFileAsync("/usr/bin/git", ["init", "-q", root]);
  await execFileAsync("/usr/bin/git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "config", "user.name", "Test"]);
  await writeFile(join(root, "tracked.txt"), "one\n");
  await execFileAsync("/usr/bin/git", ["-C", root, "add", "tracked.txt"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "commit", "-qm", "test"]);
  const state = await repositoryState(root);
  assert.equal(state.dirty, false);
  assert.equal(state.upstream, null);
  assert.equal(state.relation, null);
  assert.equal(await inspectGit(root, ["not-a-command"], { optional: true }), null);
  await assert.rejects(() => inspectGit(root, ["not-a-command"]), /failed/);
  const upstreamRoot = join(root, "upstream.git");
  await execFileAsync("/usr/bin/git", ["init", "--bare", "-q", upstreamRoot]);
  await execFileAsync("/usr/bin/git", ["-C", root, "remote", "add", "origin", upstreamRoot]);
  await execFileAsync("/usr/bin/git", ["-C", root, "push", "-qu", "origin", "HEAD"]);
  assert.deepEqual((await repositoryState(root)).relation, { ahead: 0, behind: 0 });
  await writeFile(join(root, "tracked.txt"), "two\n");
  await execFileAsync("/usr/bin/git", ["-C", root, "add", "tracked.txt"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "commit", "-qm", "ahead"]);
  assert.deepEqual((await repositoryState(root)).relation, { ahead: 1, behind: 0 });

  await mkdir(join(root, "schemas"));
  await writeFile(join(root, "schemas", "a.json"), '{"$id":"shared","value":1}\n');
  await writeFile(join(root, "schemas", "b.json"), '{"$id":"shared","value":2}\n');
  await writeFile(join(root, "schemas", "c.json"), '{"value":3}\n');
  const inventory = await schemaInventory(root);
  assert.equal(inventory.schemas.length, 3);
  assert.equal(inventory.collisions.length, 1);
  assert.deepEqual(await compareProducerContracts(root, join(root, "missing")), []);
  await mkdir(join(root, "producer", "contracts"), { recursive: true });
  await writeFile(join(root, "producer", "contracts", "a.json"), '{"$id":"shared","value":1}\n');
  assert.equal((await compareProducerContracts(root, join(root, "producer")))[0].equal, true);
  await writeFile(join(root, "producer", "contracts", "a.json"), '{"$id":"shared","value":9}\n');
  assert.equal((await compareProducerContracts(root, join(root, "producer")))[0].equal, false);
  assert.equal(await discoverProducer({ roles: [{ id: "decision_producer", local_discovery: ["missing"] }] }, root), null);
  await execFileAsync("/usr/bin/git", ["init", "-q", join(root, "producer")]);
  await execFileAsync("/usr/bin/git", ["-C", join(root, "producer"), "config", "user.email", "test@example.com"]);
  await execFileAsync("/usr/bin/git", ["-C", join(root, "producer"), "config", "user.name", "Test"]);
  await execFileAsync("/usr/bin/git", ["-C", join(root, "producer"), "add", "."]);
  await execFileAsync("/usr/bin/git", ["-C", join(root, "producer"), "commit", "-qm", "producer"]);
  const foundProducer = await discoverProducer({ roles: [{ id: "decision_producer", local_discovery: ["producer"] }] }, root);
  assert.equal(foundProducer.branch.length > 0, true);
  assert.equal(foundProducer.contracts[0].equal, false);

  const rendered = renderInspectionHuman({
    repository: { relation: null, dirty: false, changed_paths: [], branch: "main", head: "a".repeat(40) },
    release: { version: "1.0.0", manifest: { missing: true } },
    schemas: { count: 3, identity_collisions: [], producer_comparisons: [] },
    producer: null,
    health: {
      generated_views_current: true,
      changed_path_match_rate: 1,
      provenance_completeness: { complete: 0, required: 5 },
      orientation_probe_ms: 1
    },
    holds: [],
    next_safe_command: "npm run inspect -- --json"
  });
  assert.match(rendered, /no upstream relation/);
  assert.match(rendered, /Working tree: clean/);
  assert.match(rendered, /Manifest: missing/);
  assert.match(rendered, /Unpinned public schemas: 0/);
  assert.match(rendered, /Producer candidate: unavailable/);

  const richRendered = renderInspectionHuman({
    repository: { relation: { ahead: 2, behind: 1 }, dirty: true, changed_paths: ["a"], branch: "feature", head: "b".repeat(40) },
    release: {
      version: "1.1.0",
      manifest: { path: "release/current.json", sha256: "c".repeat(64) },
      unpinned_public_schemas: ["schemas/new.json"]
    },
    schemas: { count: 4, identity_collisions: [], producer_comparisons: [{ equal: true }] },
    producer: { remote: "origin", root: "/producer", branch: "master", head: "d".repeat(40), dirty: true },
    health: {
      generated_views_current: false,
      changed_path_match_rate: 0.5,
      provenance_completeness: { complete: 3, required: 5 },
      orientation_probe_ms: 9
    },
    holds: ["external proof"],
    next_safe_command: "npm run check:changed"
  });
  assert.match(richRendered, /2 ahead, 1 behind/);
  assert.match(richRendered, /Working tree: 1 changed paths/);
  assert.match(richRendered, /generated views missing/);
  assert.match(richRendered, /origin.*dirty/);
  assert.match(richRendered, /schemas\/new.json/);
});

test("verification phase execution captures output, nonzero status, launch errors, and timeout state", async () => {
  const success = await executeVerificationPhase({ id: "success", command: process.execPath, args: ["-e", "console.log('ok')"], timeout_ms: 5_000 });
  assert.equal(success.exit_code, 0);
  assert.match(success.stdout, /ok/);
  const failure = await executeVerificationPhase({ id: "failure", command: process.execPath, args: ["-e", "console.error('no');process.exit(3)"], timeout_ms: 5_000 });
  assert.equal(failure.exit_code, 3);
  assert.match(failure.stderr, /no/);
  const timeout = await executeVerificationPhase({ id: "timeout", command: process.execPath, args: ["-e", "setTimeout(()=>{},1000)"], timeout_ms: 10 });
  assert.equal(timeout.timed_out, true);
  await assert.rejects(() => executeVerificationPhase({ id: "missing", command: "/definitely/missing", args: [], timeout_ms: 100 }), /could not start/);
  await assert.rejects(() => executeVerificationPhase({ id: "bad id!", command: "x", args: [], timeout_ms: 100 }), /invalid/);
});

test("verification receipts are atomic, hash logs, stop after failure, and label stronger proof unverified", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bounder-verification-test-"));
  t.after(async () => { const { rm } = await import("node:fs/promises"); await rm(root, { recursive: true, force: true }); });
  const phases = [
    { id: "one", command: "fake", args: [], timeout_ms: 100 },
    { id: "two", command: "fake", args: [], timeout_ms: 100 }
  ];
  let time = Date.parse("2026-08-31T12:00:00Z");
  const result = await runVerification({
    root,
    outputRoot: join(root, "receipts"),
    phases,
    phaseRunner: async (phase) => ({ exit_code: phase.id === "one" ? 1 : 0, signal: null, timed_out: false, duration_ms: 5, stdout: "out", stderr: "err" }),
    candidateReader: async () => ({ publisher_commit: "a".repeat(40), producer_commits: [], dirty: true }),
    artifactPaths: [],
    clock: () => time++,
    logger: { log() {} }
  });
  assert.equal(result.receipt.success, false);
  assert.deepEqual(result.receipt.phases.map(({ id }) => id), ["one"]);
  assert.equal(result.receipt.unverified[0].phase, "two");
  assert.ok(result.receipt.unverified.some(({ proof_class }) => proof_class === "physical_safety"));
  const saved = JSON.parse(await readFile(result.receiptPath, "utf8"));
  assert.equal(saved.phases[0].log_sha256.length, 64);
  assert.equal(JSON.parse(await readFile(join(root, "receipts", "latest.json"), "utf8")).success, false);

  await assert.rejects(() => runVerification({ root, phases: [], outputRoot: join(root, "empty") }), /empty/);
  await assert.rejects(() => runVerification({ root, phases: [phases[0], phases[0]], outputRoot: join(root, "dupe") }), /duplicate/);
});

test("focused verify CLI and direct script entry points execute without external mutation", async (t) => {
  const logs = [];
  const receipts = await mkdtemp(join(tmpdir(), "bounder-verify-cli-receipts-"));
  t.after(() => rm(receipts, { recursive: true, force: true }));
  // The phase is stubbed and the receipt goes to scratch: this test covers the CLI's argument
  // handling, not the descriptor gate, and must not spawn a real build or leave evidence in the
  // working tree that reads like a genuine verification run.
  const spawned = [];
  const result = await runVerifyCli(["--phase", "descriptor"], { log: (message) => logs.push(message) }, {
    outputRoot: receipts,
    phaseRunner: async (phase) => {
      spawned.push(phase.id);
      return { exit_code: 0, signal: null, timed_out: false, duration_ms: 1, stdout: "ok", stderr: "" };
    }
  });
  assert.deepEqual(spawned, ["descriptor"], "the focused CLI ran a phase other than the one selected");
  assert.equal(result.receipt.success, true);
  assert.ok(result.receiptPath.startsWith(receipts), "the CLI wrote its receipt outside the requested output root");
  assert.match(logs.at(-1), /Verification receipt/);
  await assert.rejects(() => runVerifyCli(["--phase", "missing"], { log() {} }), /unknown/);
  await assert.rejects(() => runVerifyCli(["bad"], { log() {} }), /usage/);

  for (const [script, args] of [
    ["scripts/validate-system.mjs", []],
    ["scripts/check-changed.mjs", ["--paths", "CLAUDE.md"]],
    ["scripts/docs-check.mjs", ["--json"]],
    ["scripts/system-inspect.mjs", ["--json"]]
  ]) {
    const { stdout } = await execFileAsync(process.execPath, [script, ...args], { cwd: new URL("..", import.meta.url).pathname, maxBuffer: 8 * 1024 * 1024 });
    assert.ok(stdout.trim().length > 0, script);
  }
  await assert.rejects(
    () => execFileAsync(process.execPath, ["scripts/check-changed.mjs", "--bad"], { cwd: new URL("..", import.meta.url).pathname }),
    /Command failed/
  );
});
