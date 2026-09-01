import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  PUBLISHED_OUTPUTS,
  PRODUCER_REPOSITORY,
  SHARED_CONTRACTS,
  execute,
  inspectProducerCheckout,
  parseProducerArguments,
  validateRecordInventory,
  verifyProducerDerivation,
  verifyRecordInventory,
  verifyProducerExport
} from "../scripts/verify-producer-derivation.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);

async function record(root, relativePath) {
  const bytes = await readFile(path.join(root, relativePath));
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

test("producer record inventories reject ambiguity", () => {
  assert.throws(() => validateRecordInventory([], "fixture"), /empty/);
  assert.throws(() => validateRecordInventory([
    { path: "a", bytes: 1, sha256: "0".repeat(64) },
    { path: "a", bytes: 1, sha256: "0".repeat(64) }
  ], "fixture"), /duplicate/);
  assert.throws(() => validateRecordInventory([
    { path: "b", bytes: 1, sha256: "0".repeat(64) },
    { path: "a", bytes: 1, sha256: "0".repeat(64) }
  ], "fixture"), /sorted/);
  assert.throws(() => validateRecordInventory([{ path: "../escape", bytes: 1, sha256: "0".repeat(64) }], "fixture"), /unsafe/);
  assert.throws(() => validateRecordInventory([{ path: "a", bytes: -1, sha256: "0".repeat(64) }], "fixture"), /byte count/);
  assert.throws(() => validateRecordInventory([{ path: "a", bytes: 1, sha256: "bad" }], "fixture"), /digest/);
});

test("producer export verification checks exact contracts, outputs, hashes, and commit", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bounder-producer-export-"));
  const siteRoot = path.join(temporary, "site");
  const exportRoot = path.join(temporary, "export");
  await Promise.all([
    mkdir(path.join(siteRoot, "schemas"), { recursive: true }),
    mkdir(path.join(siteRoot, "data"), { recursive: true }),
    mkdir(path.join(exportRoot, "schemas"), { recursive: true }),
    mkdir(path.join(exportRoot, "data"), { recursive: true }),
    mkdir(path.join(exportRoot, "producer"), { recursive: true })
  ]);
  for (const name of SHARED_CONTRACTS) {
    const source = await readFile(new URL(`../schemas/${name}`, import.meta.url));
    await Promise.all([
      writeFile(path.join(siteRoot, "schemas", name), source),
      writeFile(path.join(exportRoot, "schemas", name), source)
    ]);
  }
  for (const output of PUBLISHED_OUTPUTS) {
    const bytes = Buffer.from(`${output}\n`);
    await Promise.all([
      writeFile(path.join(siteRoot, output), bytes),
      writeFile(path.join(exportRoot, output), bytes)
    ]);
  }
  const producerFixture = "producer/creedspace-fleet-evidence.v1.json";
  await writeFile(path.join(exportRoot, producerFixture), "{}\n");
  const commit = "a".repeat(40);
  const contracts = [];
  for (const name of SHARED_CONTRACTS) contracts.push(await record(exportRoot, `schemas/${name}`));
  contracts.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const outputs = [];
  for (const output of [...PUBLISHED_OUTPUTS, producerFixture].sort()) outputs.push(await record(exportRoot, output));
  const provenance = {
    version: "bounder-evidence-provenance/v1",
    producer_source: { repository: PRODUCER_REPOSITORY, commit, clean: true },
    generator: { id: "bounder-website-evidence-export", version: "1", entrypoint: "scripts/export-website-artifacts.py" },
    toolchain: { go_module: "go 1.20", python: "python 3" },
    inputs: [{ path: "scripts/export-website-artifacts.py", bytes: 1, sha256: "0".repeat(64) }],
    contracts,
    outputs
  };
  await writeFile(path.join(exportRoot, "bounder-evidence-provenance.v1.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  const verified = await verifyProducerExport({ siteRoot, exportRoot, expectedCommit: commit });
  assert.equal(verified.provenance.producer_source.commit, commit);

  await writeFile(path.join(exportRoot, PUBLISHED_OUTPUTS[0]), "drift\n");
  await assert.rejects(verifyProducerExport({ siteRoot, exportRoot, expectedCommit: commit }), /hash mismatch/);
});

test("producer export verification rejects malformed source, incomplete inventories, and byte drift at each boundary", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bounder-producer-boundaries-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const siteRoot = path.join(temporary, "site");
  const exportRoot = path.join(temporary, "export");
  await Promise.all([
    mkdir(path.join(siteRoot, "schemas"), { recursive: true }),
    mkdir(path.join(siteRoot, "data"), { recursive: true }),
    mkdir(path.join(exportRoot, "schemas"), { recursive: true }),
    mkdir(path.join(exportRoot, "data"), { recursive: true }),
    mkdir(path.join(exportRoot, "producer"), { recursive: true })
  ]);
  for (const name of SHARED_CONTRACTS) {
    const source = await readFile(new URL(`../schemas/${name}`, import.meta.url));
    await Promise.all([writeFile(path.join(siteRoot, "schemas", name), source), writeFile(path.join(exportRoot, "schemas", name), source)]);
  }
  for (const output of PUBLISHED_OUTPUTS) {
    await Promise.all([writeFile(path.join(siteRoot, output), `${output}\n`), writeFile(path.join(exportRoot, output), `${output}\n`)]);
  }
  await writeFile(path.join(exportRoot, "producer", "fixture.json"), "{}\n");
  const commit = "c".repeat(40);
  const makeProvenance = async () => {
    const contracts = [];
    for (const name of SHARED_CONTRACTS) contracts.push(await record(exportRoot, `schemas/${name}`));
    contracts.sort((left, right) => left.path.localeCompare(right.path, "en"));
    const outputs = [];
    for (const output of [...PUBLISHED_OUTPUTS, "producer/fixture.json"].sort()) outputs.push(await record(exportRoot, output));
    return {
      version: "bounder-evidence-provenance/v1",
      producer_source: { repository: PRODUCER_REPOSITORY, commit, clean: true },
      generator: { id: "bounder-website-evidence-export", version: "1", entrypoint: "scripts/export-website-artifacts.py" },
      toolchain: { go_module: "go 1.20", python: "python 3" },
      inputs: [{ path: "scripts/export-website-artifacts.py", bytes: 1, sha256: "0".repeat(64) }],
      contracts,
      outputs
    };
  };
  const provenancePath = path.join(exportRoot, "bounder-evidence-provenance.v1.json");
  const publish = (value) => writeFile(provenancePath, `${JSON.stringify(value, null, 2)}\n`);
  const pristine = await makeProvenance();

  await publish({ ...pristine, generator: undefined });
  await assert.rejects(() => verifyProducerExport({ siteRoot, exportRoot, expectedCommit: commit }), /schema validation failed/);
  await publish(pristine);
  await assert.rejects(() => verifyProducerExport({ siteRoot, exportRoot, expectedCommit: "d".repeat(40) }), /wrong source revision/);
  await publish({ ...pristine, contracts: pristine.contracts.slice(1) });
  await assert.rejects(() => verifyProducerExport({ siteRoot, exportRoot, expectedCommit: commit }), /contract inventory is incomplete/);
  await publish({ ...pristine, outputs: pristine.outputs.filter(({ path: output }) => output !== PUBLISHED_OUTPUTS[0]) });
  await assert.rejects(() => verifyProducerExport({ siteRoot, exportRoot, expectedCommit: commit }), /omits published output/);

  const schemaPath = `schemas/${SHARED_CONTRACTS[0]}`;
  await writeFile(path.join(exportRoot, schemaPath), "{}\n");
  const schemaDrift = await makeProvenance();
  await publish(schemaDrift);
  await assert.rejects(() => verifyProducerExport({ siteRoot, exportRoot, expectedCommit: commit }), /shared contract drift/);
  await writeFile(path.join(exportRoot, schemaPath), await readFile(path.join(siteRoot, schemaPath)));

  await writeFile(path.join(exportRoot, PUBLISHED_OUTPUTS[0]), "different but recorded\n");
  const evidenceDrift = await makeProvenance();
  await publish(evidenceDrift);
  await assert.rejects(() => verifyProducerExport({ siteRoot, exportRoot, expectedCommit: commit }), /producer-derived evidence drift/);

  const bounded = path.join(temporary, "bounded");
  await mkdir(bounded);
  await writeFile(path.join(bounded, "ok"), "ok\n");
  const goodRecord = { path: "ok", bytes: 3, sha256: sha256("ok\n") };
  await verifyRecordInventory(bounded, [goodRecord], "bounded");
  await assert.rejects(() => verifyRecordInventory(bounded, [{ ...goodRecord, bytes: 2 }], "bounded"), /hash mismatch/);
});

test("producer checkout identity and process execution fail closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bounder-producer-checkout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFileAsync("/usr/bin/git", ["init", "-q", root]);
  await execFileAsync("/usr/bin/git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "config", "user.name", "Test"]);
  await writeFile(path.join(root, "tracked"), "one\n");
  await execFileAsync("/usr/bin/git", ["-C", root, "add", "tracked"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "commit", "-qm", "fixture"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "remote", "add", "origin", "git@github.com:NellInc/Bounder-from-org.git"]);
  const checkout = await inspectProducerCheckout(root);
  assert.equal(checkout.repository, PRODUCER_REPOSITORY);
  await writeFile(path.join(root, "tracked"), "dirty\n");
  await assert.rejects(() => inspectProducerCheckout(root), /must be clean/);
  await execFileAsync("/usr/bin/git", ["-C", root, "checkout", "--", "tracked"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "remote", "set-url", "origin", "https://example.test/wrong.git"]);
  await assert.rejects(() => inspectProducerCheckout(root), /unexpected producer origin/);

  const success = await execute(process.execPath, ["-e", "process.stdout.write('ok');process.stderr.write('note')"], { cwd: root, timeoutMs: 5_000 });
  assert.equal(success.stdout, "ok");
  assert.equal(success.stderr, "note");
  await assert.rejects(() => execute(process.execPath, ["-e", "process.stderr.write('bad');process.exit(4)"], { cwd: root, timeoutMs: 5_000 }), /failed \(4\): bad/);
  await assert.rejects(() => execute(process.execPath, ["-e", "setTimeout(()=>{},1000)"], { cwd: root, timeoutMs: 10 }), /timeout/);
  await assert.rejects(() => execute("/definitely/missing", [], { cwd: root, timeoutMs: 100 }), /ENOENT/);
});

test("producer derivation orchestration emits an atomic receipt and always removes scratch state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bounder-producer-orchestration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputRoot = path.join(root, "receipts");
  const producer = { root: path.join(root, "producer"), commit: "d".repeat(40), repository: PRODUCER_REPOSITORY, default_ref: "master" };
  const provenance = { version: "bounder-evidence-provenance/v1" };
  const times = ["2026-09-01T12:00:00.000Z", "2026-09-01T12:00:01.000Z"];
  const result = await verifyProducerDerivation({
    siteRoot: root,
    producerRoot: producer.root,
    outputRoot,
    checkoutInspector: async () => producer,
    commandRunner: async (command, args, options) => {
      assert.equal(command, "python3");
      assert.equal(args[0], "scripts/export-website-artifacts.py");
      assert.equal(options.cwd, producer.root);
      return { stdout: "generated\n", stderr: "" };
    },
    exportVerifier: async ({ expectedCommit }) => {
      assert.equal(expectedCommit, producer.commit);
      return { provenance, provenance_sha256: "e".repeat(64) };
    },
    gitRunner: async () => "f".repeat(40),
    clock: () => times.shift()
  });
  assert.equal(result.receipt.success, true);
  assert.equal(result.receipt.producer_statement, provenance);
  assert.equal(JSON.parse(await readFile(path.join(outputRoot, "latest.json"), "utf8")).producer.commit, producer.commit);
  assert.equal((await readdir(outputRoot)).some((name) => name.startsWith(".work-")), false);

  const failureRoot = path.join(root, "failures");
  await assert.rejects(() => verifyProducerDerivation({
    siteRoot: root,
    producerRoot: producer.root,
    outputRoot: failureRoot,
    checkoutInspector: async () => producer,
    commandRunner: async () => { throw new Error("export failed"); }
  }), /export failed/);
  assert.equal((await readdir(failureRoot)).some((name) => name.startsWith(".work-")), false);
});

test("producer command arguments accept an explicit path or environment and reject ambiguity", () => {
  assert.deepEqual(parseProducerArguments(["--producer-root", "/explicit", "--json"], {}), { producerRoot: "/explicit", json: true });
  assert.deepEqual(parseProducerArguments([], { BOUNDER_PRODUCER_ROOT: "/environment" }), { producerRoot: "/environment", json: false });
  assert.throws(() => parseProducerArguments(["--producer-root"], {}), /requires a path/);
  assert.throws(() => parseProducerArguments(["--bad"], {}), /unknown/);
  assert.throws(() => parseProducerArguments([], {}), /set BOUNDER_PRODUCER_ROOT/);
});
