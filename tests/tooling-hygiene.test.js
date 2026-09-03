import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertFileLine, checkDocumentation } from "../scripts/docs-check.mjs";
import { isMainModule } from "../scripts/lib/system-model.mjs";
import {
  compareVersions,
  listSealedManifests,
  resolveProducerCommit,
  runResolveProducerCommitCli
} from "../scripts/lib/release-producer.mjs";
import { executeVerificationPhase, readProducerReceiptStatus } from "../scripts/verify.mjs";
import { verifyChanged } from "../scripts/verify-changed.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

async function temporaryRoot(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function fakeChild({ pid = 4242 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = [];
  child.kill = (signal) => {
    child.killed.push(signal);
    return true;
  };
  return child;
}

test("the toolchain pins its Node floor in exactly one place and ignores machine-local scratch", async () => {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.match(manifest.engines?.node ?? "", /^>=22\./, "package.json declares no Node floor");
  const nvmrc = await readFile(join(repositoryRoot, ".nvmrc"), "utf8");
  assert.equal(nvmrc, "22\n");
  for (const name of ["deploy-pages.yml", "site-quality.yml", "receipt-drift.yml"]) {
    const workflow = await readFile(join(repositoryRoot, ".github", "workflows", name), "utf8");
    assert.doesNotMatch(workflow, /node-version: /, `${name} pins a Node version away from .nvmrc`);
    assert.match(workflow, /node-version-file: (publisher\/)?\.nvmrc/, `${name} does not read the declared Node floor`);
    assert.doesNotMatch(workflow, /^\s*(- )?run: npm ci$/m, `${name} runs dependency install scripts`);
  }

  // The design lint is a release gate; it must run the version pinned in the lockfile rather
  // than a tarball fetched from the network at deploy time.
  assert.match(manifest.scripts.quality, /node_modules\/\.bin\/impeccable detect \./);
  assert.doesNotMatch(manifest.scripts.quality, /npx/);
  assert.equal(manifest.devDependencies.impeccable, "3.2.1", "the design linter must be exactly pinned");
  const descriptor = JSON.parse(await readFile(join(repositoryRoot, "system", "bounder-system.v1.json"), "utf8"));
  const designLint = descriptor.commands.find(({ id }) => id === "design_lint");
  assert.deepEqual(designLint.argv, ["node_modules/.bin/impeccable", "detect", "."]);

  // A fixed coverage scratch path is shared across concurrent runs and across users; --clean
  // then deletes another run's V8 output mid-flight and moves the per-file floors under it.
  assert.doesNotMatch(manifest.scripts["test:coverage"], /--temp-directory=\/tmp\/[a-z0-9-]+ /);
  assert.match(manifest.scripts["test:coverage"], /--temp-directory="\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/bounder-c8-XXXXXX"\)"/);

  const ignored = await readFile(join(repositoryRoot, ".gitignore"), "utf8");
  assert.match(ignored, /^tmp\/$/m, "scratch under tmp/ is not ignored");
});

test("CLI entry guards survive a checkout path that needs percent-encoding", () => {
  const spaced = "/Users/nell watson/GitHub/Bounder/scripts/check-changed.mjs";
  const url = new URL(`file://${encodeURI(spaced)}`).href;
  assert.match(url, /%20/, "the fixture does not exercise percent-encoding");
  assert.equal(isMainModule(url, spaced), true, "the guard must match a raw argv path against an encoded module URL");
  assert.equal(isMainModule(url, "/Users/nell watson/GitHub/Bounder/scripts/verify.mjs"), false);
  assert.equal(isMainModule(url, undefined), false);
});

test("the verified producer commit is derived from the newest sealed manifest, ordered numerically", async (t) => {
  const resolved = await resolveProducerCommit(repositoryRoot);
  assert.match(resolved.commit, /^[0-9a-f]{40}$/);
  assert.equal(resolved.repository, "https://github.com/NellInc/Bounder-from-org");
  const workflow = await readFile(join(repositoryRoot, ".github", "workflows", "receipt-drift.yml"), "utf8");
  assert.ok(workflow.includes(resolved.commit) === false, "the workflow restates a commit the manifest already names");

  assert.equal(compareVersions([1, 10, 0], [1, 9, 0]) > 0, true, "version ordering must be numeric, not lexical");
  assert.equal(compareVersions([1, 1, 1], [1, 1, 1]), 0);

  const root = await temporaryRoot(t, "bounder-producer-resolve-");
  await mkdir(join(root, "release"), { recursive: true });
  await assert.rejects(() => resolveProducerCommit(root), /no sealed release manifest/);

  const manifest = (version, commit) => `${JSON.stringify({
    manifest_version: "bounder-release-manifest/v2",
    release_version: version,
    evidence_producers: [{ role: "decision_producer", repository: "https://example.invalid/p", commit }]
  })}\n`;
  await writeFile(join(root, "release", "bounder-reference-v1.9.0.manifest.json"), manifest("1.9.0", "a".repeat(40)));
  await writeFile(join(root, "release", "bounder-reference-v1.10.0.manifest.json"), manifest("1.10.0", "b".repeat(40)));
  await writeFile(join(root, "release", "notes.md"), "not a manifest\n");
  assert.deepEqual((await listSealedManifests(root)).map(({ name }) => name), [
    "bounder-reference-v1.9.0.manifest.json",
    "bounder-reference-v1.10.0.manifest.json"
  ]);
  assert.equal((await resolveProducerCommit(root)).commit, "b".repeat(40));

  const logged = [];
  await runResolveProducerCommitCli(["--commit"], { root, logger: { log: (line) => logged.push(line) } });
  assert.deepEqual(logged, ["b".repeat(40)]);
  await runResolveProducerCommitCli([], { root, logger: { log: (line) => logged.push(line) } });
  assert.equal(JSON.parse(logged[1]).release_version, "1.10.0");
  await assert.rejects(() => runResolveProducerCommitCli(["--nope"], { root, logger: { log() {} } }), /unknown/);

  await writeFile(join(root, "release", "bounder-reference-v1.11.0.manifest.json"), manifest("1.11.0", "not-a-commit"));
  await assert.rejects(() => resolveProducerCommit(root), /invalid decision_producer commit/);
  await writeFile(join(root, "release", "bounder-reference-v1.11.0.manifest.json"), `${JSON.stringify({
    manifest_version: "bounder-release-manifest/v2",
    release_version: "1.11.0",
    evidence_producers: []
  })}\n`);
  await assert.rejects(() => resolveProducerCommit(root), /declares no evidence producer/);
  await writeFile(join(root, "release", "bounder-reference-v1.11.0.manifest.json"), `${JSON.stringify({ release_version: "1.11.0" })}\n`);
  await assert.rejects(() => resolveProducerCommit(root), /not a manifest v2 record/);
});

test("phase output is decoded once, so a multi-byte sequence split across chunks keeps its digest stable", async () => {
  const marker = "✓ policy — résumé 🔒";
  const bytes = Buffer.from(`${marker}\n`, "utf8");
  const runWithSplitAt = async (offset) => {
    const child = fakeChild();
    const result = executeVerificationPhase(
      { id: "split", command: "npm", args: ["run", "noop"], timeout_ms: 60_000 },
      { spawnImpl: () => child }
    );
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    child.stdout.emit("data", bytes.subarray(0, offset));
    child.stdout.emit("data", bytes.subarray(offset));
    child.emit("close", 0, null);
    return result;
  };
  // Byte 1 lands inside the U+2713 sequence; every prior implementation produced U+FFFD there.
  const split = await runWithSplitAt(1);
  const whole = await runWithSplitAt(bytes.byteLength);
  assert.equal(split.stdout, `${marker}\n`);
  assert.equal(split.stdout, whole.stdout, "phase output depends on stream chunking");
  assert.equal(split.stdout.includes("�"), false);
});

test("a timed-out phase signals the whole process group and escalates to SIGKILL", async () => {
  const child = fakeChild({ pid: 4242 });
  const signalled = [];
  const scheduled = [];
  const timers = {
    setTimeout(callback, delay) {
      const handle = { callback, delay, cleared: false };
      scheduled.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      if (handle) handle.cleared = true;
    }
  };
  const result = executeVerificationPhase(
    { id: "hang", command: "npm", args: ["run", "browser"], timeout_ms: 1_000 },
    { spawnImpl: () => child, timers, killImpl: (pid, signal) => signalled.push([pid, signal]), escalationMs: 5_000 }
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  scheduled[0].callback();
  assert.deepEqual(signalled, [[-4242, "SIGTERM"]], "SIGTERM reached only the wrapper, not its group");
  assert.equal(child.killed.length, 0, "the direct-child fallback must not fire when the group kill succeeds");
  assert.equal(scheduled.length, 2, "no SIGKILL escalation was scheduled");
  scheduled[1].callback();
  assert.deepEqual(signalled[1], [-4242, "SIGKILL"]);

  child.emit("close", null, "SIGKILL");
  const settled = await result;
  assert.equal(settled.timed_out, true, "a killed phase must still be recorded as a timeout");
  assert.equal(settled.exit_code, 1);
  assert.equal(scheduled.every((handle) => handle.cleared), true, "timers leaked after the phase closed");
});

test("a group kill that cannot be delivered falls back to the direct child without throwing", async () => {
  const child = fakeChild({ pid: 77 });
  const scheduled = [];
  const timers = {
    setTimeout(callback) {
      const handle = { callback, cleared: false };
      scheduled.push(handle);
      return handle;
    },
    clearTimeout(handle) { if (handle) handle.cleared = true; }
  };
  const result = executeVerificationPhase(
    { id: "unkillable", command: "npm", args: ["run", "noop"], timeout_ms: 5 },
    {
      spawnImpl: () => child,
      timers,
      killImpl: () => { throw Object.assign(new Error("no such group"), { code: "ESRCH" }); }
    }
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  scheduled[0].callback();
  assert.deepEqual(child.killed, ["SIGTERM"]);
  child.emit("close", 0, null);
  assert.equal((await result).timed_out, true);
});

test("an interrupted runner forwards the signal into the phase group before dying of it", async () => {
  const child = fakeChild({ pid: 909 });
  const listeners = new Map();
  const raised = [];
  const signalled = [];
  const processApi = {
    pid: 909_000,
    on(signal, handler) { listeners.set(signal, handler); },
    off(signal, handler) { if (listeners.get(signal) === handler) listeners.delete(signal); },
    kill(pid, signal) { raised.push([pid, signal]); return true; }
  };
  const result = executeVerificationPhase(
    { id: "interrupted", command: "npm", args: ["run", "test:browser"], timeout_ms: 600_000 },
    { spawnImpl: () => child, processApi, killImpl: (pid, signal) => signalled.push([pid, signal]) }
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.deepEqual([...listeners.keys()].sort(), ["SIGINT", "SIGTERM"]);

  listeners.get("SIGINT")("SIGINT");
  // The phase group dies first, so a killed run cannot leave its HTTP server holding port 4173.
  assert.deepEqual(signalled, [[-909, "SIGINT"]]);
  assert.deepEqual(raised, [[909_000, "SIGINT"]], "the runner must still die of the signal it forwarded");
  assert.equal(listeners.size, 0);

  child.emit("close", 0, null);
  assert.equal((await result).exit_code, 0);
});

test("a phase that completes normally leaves no signal forwarders behind", async () => {
  const child = fakeChild();
  const listeners = new Map();
  const processApi = {
    pid: process.pid,
    on(signal, handler) { listeners.set(signal, handler); },
    off(signal, handler) { if (listeners.get(signal) === handler) listeners.delete(signal); },
    kill() { return true; }
  };
  const result = executeVerificationPhase(
    { id: "clean", command: "npm", args: ["run", "noop"], timeout_ms: 60_000 },
    { spawnImpl: () => child, processApi }
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(listeners.size, 2);
  child.emit("close", 0, null);
  await result;
  assert.equal(listeners.size, 0);

  // A phase that never starts must not leak them either.
  const failing = fakeChild();
  const failingResult = executeVerificationPhase(
    { id: "missing", command: "nope", args: [], timeout_ms: 60_000 },
    { spawnImpl: () => failing, processApi }
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  failing.emit("error", new Error("spawn ENOENT"));
  await assert.rejects(() => failingResult, /could not start/);
  assert.equal(listeners.size, 0);
});

test("an absent, unreadable, and drifted producer receipt are three distinguishable facts", async (t) => {
  const root = await temporaryRoot(t, "bounder-producer-status-");
  const latest = join(root, "artifacts", "producer-derivation", "latest.json");
  await mkdir(join(root, "artifacts", "producer-derivation"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });

  await rm(latest, { force: true });
  const absent = await readProducerReceiptStatus(root);
  assert.deepEqual(absent, { present: false, producer_commits: [], reason: "no producer-derivation receipt is present" });

  await writeFile(latest, "{not json\n");
  const unreadable = await readProducerReceiptStatus(root);
  assert.equal(unreadable.present, false);
  assert.match(unreadable.reason, /could not be read/);

  const evidence = "{\"generated\":true}\n";
  await writeFile(join(root, "data", "evidence.json"), evidence);
  const receipt = (sha256) => ({
    version: "bounder-producer-derivation-verification/v1",
    success: true,
    producer_statement: {
      version: "bounder-evidence-provenance/v1",
      producer_source: { commit: "c".repeat(40) },
      contracts: [],
      outputs: [{ path: "data/evidence.json", bytes: Buffer.byteLength(evidence), sha256 }]
    }
  });
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(evidence).digest("hex");
  await writeFile(latest, `${JSON.stringify(receipt(digest))}\n`);
  assert.deepEqual(await readProducerReceiptStatus(root), {
    present: true,
    producer_commits: ["c".repeat(40)],
    reason: null
  });

  // Detected drift must not read as "no producer run has happened".
  await writeFile(latest, `${JSON.stringify(receipt("0".repeat(64)))}\n`);
  const drifted = await readProducerReceiptStatus(root);
  assert.equal(drifted.present, true);
  assert.deepEqual(drifted.producer_commits, []);
  assert.equal(drifted.reason, "producer receipt drift: data/evidence.json");

  await writeFile(latest, `${JSON.stringify({ version: "wrong", success: true })}\n`);
  assert.equal((await readProducerReceiptStatus(root)).reason, "producer receipt is not successful and complete");
});

test("changed-path verification records a phase that cannot spawn instead of losing the receipt", async (t) => {
  // `root` stays the repository because the change-selection logic reads its descriptor, but the
  // receipt is a synthetic failure and belongs in scratch, not in the working tree.
  const root = repositoryRoot;
  const outputRoot = join(await temporaryRoot(t, "bounder-spawn-failure-"), "changed-verification");
  const runs = [];
  await assert.rejects(
    () => verifyChanged(["--paths", "README.md"], {
      root,
      outputRoot,
      logger: { log: (line) => runs.push(line) },
      phaseRunner: async (phase) => {
        throw new Error(`verification phase ${phase.id} could not start: spawn EAGAIN`);
      }
    }),
    /changed-path verification failed/
  );
  const latest = JSON.parse(await readFile(join(outputRoot, "latest.json"), "utf8"));
  assert.equal(latest.success, false);
  assert.ok(latest.phases.length > 0, "a spawn failure produced no phase record");
  assert.equal(latest.phases[0].exit_code, 1);
});

test("docs:check contains citations to the repository and verifies quoted anchors", async (t) => {
  const root = await temporaryRoot(t, "bounder-docs-containment-");
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "README.md"), "alpha\nbeta gamma\ndelta\n");

  // A sibling checkout outside the repository -- the private producer tree lives exactly here.
  const outside = join(root, "..", `${root.split("/").pop()}-from-org`);
  await mkdir(outside, { recursive: true });
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "README.md"), "private producer content\n");

  await assert.rejects(
    () => assertFileLine(root, `../${outside.split("/").pop()}/README.md`, 1, 1, "page"),
    /unsafe citation path/
  );
  await assert.rejects(() => assertFileLine(root, "../../etc/hosts", 1, 1, "page"), /unsafe citation path/);
  await assert.rejects(() => assertFileLine(root, ".", 1, 1, "page"), /unsafe citation path/);
  await assertFileLine(root, "README.md", 2, 2, "page");

  // The anchor turns "the file is long enough" into "the cited lines say what is claimed".
  await assertFileLine(root, "README.md", 2, 2, "page", "beta gamma");
  await assert.rejects(
    () => assertFileLine(root, "README.md", 1, 1, "page", "beta gamma"),
    /anchor absent from that range: "beta gamma"/
  );
});

test("every impact rule routes to the pages that cite its paths", async (t) => {
  // documentation_refresh is the only mechanism that tells an editor which prose a code change
  // endangers. It was hand-maintained and had gone stale: a descriptor edit routed to one of
  // the three pages citing the descriptor, so five citations on the other two went unflagged.
  const { checkDocumentation: check } = await import("../scripts/docs-check.mjs");
  const live = await check({ root: repositoryRoot });
  assert.deepEqual(live.routing_warnings, [], "an impact rule no longer routes to a page citing its paths");

  const root = await temporaryRoot(t, "bounder-doc-routing-");
  await mkdir(join(root, "_wiki", "systems"), { recursive: true });
  await mkdir(join(root, "guides"), { recursive: true });
  await writeFile(join(root, "_wiki", "index.md"), "[[bounder:systems/one]]\n");
  await writeFile(join(root, "_wiki", "log.md"), "## [2026-08-31] entry\n");
  await writeFile(join(root, "_wiki", "systems", "one.md"), "# One\n\n<!-- wiki:updated = 2026-08-31 -->\n\nCites `runtime/policy/core.js:1`.\n");
  await mkdir(join(root, "runtime", "policy"), { recursive: true });
  await writeFile(join(root, "runtime", "policy", "core.js"), "export const core = 1;\n");
  for (const name of ["README.md", "SECURITY.md", "CLAUDE.md"]) await writeFile(join(root, name), "clean\n");
  await writeFile(join(root, "guides", "INTEGRATION.md"), "clean\n");

  const rule = (documentation_refresh) => ({
    documentation: { wiki_index: "_wiki/index.md", wiki_log: "_wiki/log.md", claim_holds: [] },
    impact_rules: [{ id: "policy", paths: ["runtime/policy/**"], documentation_refresh }]
  });

  const unrouted = await check({ root, model: rule([]) });
  assert.deepEqual(unrouted.errors, [], "the fixture failed for an unrelated reason");
  assert.deepEqual(unrouted.routing_warnings, [
    "impact rule policy does not route to pages citing its paths: _wiki/systems/one.md"
  ]);

  const routed = await check({ root, model: rule(["_wiki/systems/one.md"]) });
  assert.deepEqual(routed.routing_warnings, []);

  // Routing is advisory: a page that needs re-reading must not fail the gate, because no check
  // can establish that the sentence wrapped around a citation is still true.
  assert.deepEqual(unrouted.errors, []);
});

test("generated wiki pages carry no hand-written freshness marker and are still checked", async (t) => {
  const root = await temporaryRoot(t, "bounder-docs-generated-");
  await mkdir(join(root, "_wiki", "generated"), { recursive: true });
  await writeFile(join(root, "_wiki", "index.md"), "[[bounder:generated/task-routes]]\n[[bounder:systems/one]]\n");
  await writeFile(join(root, "_wiki", "log.md"), "## [2026-08-31] entry\n");
  await writeFile(join(root, "_wiki", "generated", "task-routes.md"), "# Generated\n\n<!-- wiki:created = 2026-08-31 -->\n");
  await mkdir(join(root, "_wiki", "systems"), { recursive: true });
  await writeFile(join(root, "_wiki", "systems", "one.md"), "# One\n\n<!-- wiki:updated = 2026-08-31 -->\n");
  for (const name of ["README.md", "SECURITY.md", "CLAUDE.md"]) await writeFile(join(root, name), "clean\n");
  await mkdir(join(root, "guides"), { recursive: true });
  await writeFile(join(root, "guides", "INTEGRATION.md"), "clean\n");

  const model = {
    documentation: { wiki_index: "_wiki/index.md", wiki_log: "_wiki/log.md", claim_holds: [] }
  };
  const report = await checkDocumentation({ root, model });
  assert.deepEqual(report.errors, []);
  assert.equal(report.anchored_citations, 0);

  // A hand-written page without the marker is still an error.
  await writeFile(join(root, "_wiki", "systems", "one.md"), "# One\n");
  await assert.rejects(() => checkDocumentation({ root, model }), /invalid or future wiki:updated/);

  // A generated page still has to be reachable from the index.
  await writeFile(join(root, "_wiki", "systems", "one.md"), "# One\n\n<!-- wiki:updated = 2026-08-31 -->\n");
  await writeFile(join(root, "_wiki", "index.md"), "[[bounder:systems/one]]\n");
  await assert.rejects(() => checkDocumentation({ root, model }), /generated\/task-routes\.md is missing from _wiki\/index\.md/);
});
