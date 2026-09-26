import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  HISTORICAL_MANIFEST_SHA256,
  assertHistoricalManifests,
  assertPublisherCommit,
  assertCommitInventoryComplete,
  assertCompleteVerification,
  assertReceipt,
  assertStatementMatchesInventory,
  buildManifestV2,
  compareInventoryPaths,
  fileReceipt,
  inventoryHash,
  parseReleaseManifestV2Arguments,
  validateManifest
} from "../scripts/generate-release-manifest-v2.mjs";
import { COMPLETE_VERIFICATION_CLAIMS, DEFAULT_VERIFICATION_PHASES, PRODUCER_VERIFICATION_CLAIMS } from "../scripts/verify.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);
const fileRecord = (path, source = `${path}\n`) => ({ path, bytes: Buffer.byteLength(source), sha256: sha256(source) });

async function makeManifestFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bounder-manifest-v2-"));
  const receipts = await mkdtemp(join(tmpdir(), "bounder-manifest-v2-receipts-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(receipts, { recursive: true, force: true })]));
  await Promise.all([mkdir(join(root, "data"), { recursive: true }), mkdir(join(root, "schemas"), { recursive: true })]);
  const publicSources = {
    "VERSION": "1.1.0\n",
    "README.md": "fixture\n",
    "data/bounder-fleet-evidence.v1.json": "{}\n",
    "data/bounder-staging-pilot.v1.json": "{}\n",
    "data/creedspace-bounder-manipulator-profile-v1.example.json": "{\"mirror\":true}\n",
    "schemas/shared-contract.schema.json": "{}\n"
  };
  await Promise.all([
    ...Object.entries(publicSources).map(([path, source]) => writeFile(join(root, path), source)),
    readFile(new URL("../schemas/bounder-release-manifest-v2.schema.json", import.meta.url)).then((source) => writeFile(join(root, "schemas", "bounder-release-manifest-v2.schema.json"), source))
  ]);
  await execFileAsync("/usr/bin/git", ["init", "-q", root]);
  await execFileAsync("/usr/bin/git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "config", "user.name", "Test"]);
  await execFileAsync("/usr/bin/git", ["-C", root, "add", "."]);
  await execFileAsync("/usr/bin/git", ["-C", root, "commit", "-qm", "fixture"]);
  const { stdout } = await execFileAsync("/usr/bin/git", ["-C", root, "rev-parse", "HEAD"]);
  const publisherCommit = stdout.trim();
  const producerCommit = "a".repeat(40);
  const producerRecord = fileRecord("producer/input.json");
  const producerReceiptPath = join(receipts, "producer.json");
  const verificationReceiptPath = join(receipts, "verification.json");
  const producerReceipt = {
    version: "bounder-producer-derivation-verification/v1",
    success: true,
    producer: { commit: producerCommit, default_ref_contains_commit: true },
    producer_statement: {
      version: "bounder-evidence-provenance/v1",
      producer_source: { repository: "https://github.com/NellInc/Bounder-from-org", commit: producerCommit },
      generator: { entrypoint: "scripts/export-website-artifacts.py", version: "1" },
      inputs: [producerRecord],
      contracts: [fileRecord("schemas/shared-contract.schema.json", "{}\n")],
      outputs: [producerRecord]
    }
  };
  // A realistic complete receipt: every default phase passed, the full claim set, and the
  // producer tree the seal cites. A fixture without these would lock in the missing checks.
  const verificationReceipt = {
    version: "bounder-verification/v1",
    scope: "complete",
    success: true,
    candidate: { publisher_commit: publisherCommit, producer_commits: [producerCommit], dirty: false },
    environment: { node: "v22.0.0" },
    phases: DEFAULT_VERIFICATION_PHASES.map(({ id }) => ({ id, exit_code: 0, signal: null, timed_out: false })),
    claims: [...COMPLETE_VERIFICATION_CLAIMS, ...PRODUCER_VERIFICATION_CLAIMS]
  };
  await Promise.all([
    writeFile(producerReceiptPath, `${JSON.stringify(producerReceipt)}\n`),
    writeFile(verificationReceiptPath, `${JSON.stringify(verificationReceipt)}\n`)
  ]);
  return {
    root,
    publisherCommit,
    producerReceiptPath,
    verificationReceiptPath,
    producerReceipt,
    verificationReceipt,
    publicPaths: Object.keys(publicSources)
  };
}

test("release manifest v2 preserves every historical manifest digest", async () => {
  for (const [path, expected] of Object.entries(HISTORICAL_MANIFEST_SHA256)) {
    const bytes = await readFile(new URL(`../${path}`, import.meta.url));
    assert.equal(sha256(bytes), expected, path);
    const historical = JSON.parse(bytes);
    // The v2 format arrived with the 1.1.0 line. Deriving that boundary from the version keeps
    // the assertion honest as later releases are pinned instead of naming one file forever.
    const [major, minor] = path.match(/v(\d+)\.(\d+)\.\d+\.manifest\.json$/u).slice(1, 3).map(Number);
    if (major > 1 || (major === 1 && minor >= 1)) {
      assert.equal(historical.manifest_version, "bounder-release-manifest/v2", `${path} lost its original v2 identity`);
    } else {
      assert.equal(Object.hasOwn(historical, "manifest_version"), false, `${path} history was rewritten as v2`);
    }
  }
});

test("every sealed release manifest on disk is pinned as byte-immutable", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const versionText = await readFile(join(root, "VERSION"), "utf8");
  const currentVersion = versionText.trim();
  const sealed = (await readdir(join(root, "release")))
    .filter((entry) => entry.endsWith(".manifest.json"))
    .sort();
  assert.ok(sealed.length > 0, "the release directory holds no sealed manifests");
  for (const name of sealed) {
    // The manifest for the release line currently being prepared is sealed in its own commit
    // after this suite runs, so it is pinned in the next release's source commit, not this one.
    if (name === `bounder-reference-v${currentVersion}.manifest.json`) continue;
    assert.ok(
      Object.hasOwn(HISTORICAL_MANIFEST_SHA256, `release/${name}`),
      `release/${name} is sealed but not pinned in HISTORICAL_MANIFEST_SHA256`
    );
  }
});

test("historical manifest verification fails when a sealed manifest is left unpinned", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bounder-manifest-completeness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "release"), { recursive: true });
  const pinned = `${JSON.stringify({ release_version: "1.0.0" })}\n`;
  await writeFile(join(root, "release", "bounder-reference-v1.0.0.manifest.json"), pinned);
  const digests = { "release/bounder-reference-v1.0.0.manifest.json": sha256(Buffer.from(pinned)) };
  await assertHistoricalManifests(root, digests);

  await writeFile(join(root, "release", "bounder-reference-v1.0.1.manifest.json"), `${JSON.stringify({ release_version: "1.0.1" })}\n`);
  await assert.rejects(
    () => assertHistoricalManifests(root, digests),
    /sealed manifest is not pinned as immutable: release\/bounder-reference-v1\.0\.1\.manifest\.json/
  );

  // A root with no release directory at all is not a completeness failure.
  const bare = await mkdtemp(join(tmpdir(), "bounder-manifest-bare-"));
  t.after(() => rm(bare, { recursive: true, force: true }));
  await assertHistoricalManifests(bare, {});
});

test("release manifest v2 requires separate producer, publisher, deployment, and observation provenance", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/bounder-release-manifest-v2.schema.json", import.meta.url)));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const file = { path: "README.md", bytes: 1, sha256: "a".repeat(64) };
  const manifest = {
    manifest_version: "bounder-release-manifest/v2",
    release_version: "1.1.0",
    license: "Apache-2.0",
    generated_at: "2026-09-01T00:00:00Z",
    publisher_source: { repository: "https://github.com/NellInc/Bounder", commit: "b".repeat(40), discovery_ref: "main" },
    evidence_producers: [{
      role: "decision_producer",
      repository: "https://github.com/NellInc/Bounder-from-org",
      commit: "c".repeat(40),
      discovery_ref: "master",
      generator: "scripts/export-website-artifacts.py@1",
      inputs: [file],
      contracts: [file],
      outputs: [file],
      verification_receipt_sha256: "d".repeat(64)
    }],
    build: { command: "npm run build", node: "v22.0.0", public_inventory_sha256: "e".repeat(64), verification_receipt_sha256: "f".repeat(64) },
    deployment: { status: "unverified", reason: "Local candidate only." },
    live_observation: { status: "unverified", reason: "Requires authorized live verification." },
    observations: [{ path: "data/observation.json", classification: "recorded_observation", sha256: "1".repeat(64), limitation: "Historical observation." }],
    files: [file]
  };
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  const collapsed = structuredClone(manifest);
  collapsed.publisher_source.repository = collapsed.evidence_producers[0].repository;
  assert.equal(validate(collapsed), false);
  const claimedLive = structuredClone(manifest);
  claimedLive.deployment.status = "verified";
  assert.equal(validate(claimedLive), false);
});

test("release manifest v2 builds deterministically from exact source and successful proof receipts", async (t) => {
  const fixture = await makeManifestFixture(t);
  const options = { ...fixture, historicalManifestDigests: {} };
  const manifest = await buildManifestV2(options);
  assert.equal(manifest.publisher_source.commit, fixture.publisherCommit);
  assert.equal(manifest.evidence_producers[0].commit, "a".repeat(40));
  assert.equal(manifest.observations.length, 3);
  assert.deepEqual(manifest.observations[2], {
    path: "data/creedspace-bounder-manipulator-profile-v1.example.json",
    classification: "recorded_observation",
    sha256: sha256("{\"mirror\":true}\n"),
    limitation: manifest.observations[2].limitation
  });
  assert.match(manifest.observations[2].limitation, /not in the decision producer's evidence statement/);
  assert.equal(manifest.files.length, fixture.publicPaths.length);
  // Code-unit order, which any verifier can reproduce; ICU "en" collation would put data/ first.
  const paths = manifest.files.map(({ path }) => path);
  assert.deepEqual(paths, [...paths].sort(compareInventoryPaths));
  assert.deepEqual(paths.slice(0, 2), ["README.md", "VERSION"]);
  assert.equal(manifest.build.public_inventory_sha256, inventoryHash(manifest.files));
  await validateManifest(fixture.root, manifest);
  await assertPublisherCommit(fixture.root, fixture.publisherCommit, manifest.files);
  assert.equal((await fileReceipt(fixture.producerReceiptPath, fixture.producerReceipt.version, "producer")).value.success, true);

  const malformed = structuredClone(manifest);
  malformed.deployment.status = "verified";
  await assert.rejects(() => validateManifest(fixture.root, malformed), /schema validation failed/);
});

test("release manifest v2 rejects stale history, receipts, source identity, and incomplete observations", async (t) => {
  const fixture = await makeManifestFixture(t);
  const options = { ...fixture, historicalManifestDigests: {} };
  await assert.rejects(() => assertHistoricalManifests(fixture.root, { "README.md": "0".repeat(64) }), /historical manifest changed/);
  for (const value of [null, [], { version: "wrong", success: true }, { version: "v", success: false }]) {
    assert.throws(() => assertReceipt(value, "v", "fixture"), /not a successful/);
  }
  await assert.rejects(() => assertPublisherCommit(fixture.root, "BAD", []), /full lowercase/);
  await assert.rejects(() => assertPublisherCommit(fixture.root, "f".repeat(40), []), /cat-file/);
  await assert.rejects(
    () => assertPublisherCommit(fixture.root, fixture.publisherCommit, [{ path: "README.md", bytes: 999, sha256: "0".repeat(64) }]),
    /source differs/
  );

  const writeProducer = async (mutate) => {
    const receipt = structuredClone(fixture.producerReceipt);
    mutate(receipt);
    await writeFile(fixture.producerReceiptPath, `${JSON.stringify(receipt)}\n`);
  };
  await writeProducer((receipt) => { receipt.success = false; });
  await assert.rejects(() => buildManifestV2(options), /not a successful/);
  await writeProducer((receipt) => { delete receipt.producer_statement; });
  await assert.rejects(() => buildManifestV2(options), /no complete evidence statement/);
  await writeProducer((receipt) => { receipt.producer_statement.producer_source.commit = "b".repeat(40); });
  await assert.rejects(() => buildManifestV2(options), /commit disagreement/);
  // discovery_ref "master" must be true of the producer commit when the seal is made.
  for (const mutate of [
    (receipt) => { receipt.producer.default_ref_contains_commit = false; },
    (receipt) => { delete receipt.producer.default_ref_contains_commit; }
  ]) {
    await writeProducer(mutate);
    await assert.rejects(() => buildManifestV2(options), /not recorded as reachable from origin\/master/);
  }
  await writeFile(fixture.producerReceiptPath, `${JSON.stringify(fixture.producerReceipt)}\n`);

  const writeVerification = async (mutate) => {
    const receipt = structuredClone(fixture.verificationReceipt);
    mutate(receipt);
    await writeFile(fixture.verificationReceiptPath, `${JSON.stringify(receipt)}\n`);
  };
  await writeVerification((receipt) => { receipt.candidate.dirty = true; });
  await assert.rejects(() => buildManifestV2(options), /clean source commit/);
  await writeFile(fixture.verificationReceiptPath, `${JSON.stringify(fixture.verificationReceipt)}\n`);
  await assert.rejects(() => buildManifestV2({ ...options, publicPaths: ["VERSION", "README.md", "schemas/shared-contract.schema.json"] }), /recorded observation is missing/);

  await writeFile(join(fixture.root, "VERSION"), "1.1.0");
  await assert.rejects(() => buildManifestV2(options), /VERSION must contain/);
});

test("release manifest v2 command arguments are exact and complete", () => {
  assert.deepEqual(parseReleaseManifestV2Arguments([
    "--publisher-commit", "a",
    "--producer-receipt", "b",
    "--verification-receipt", "c"
  ]), { publisher_commit: "a", producer_receipt: "b", verification_receipt: "c" });
  assert.throws(() => parseReleaseManifestV2Arguments(["--bad"]), /unknown/);
  assert.throws(() => parseReleaseManifestV2Arguments(["--publisher-commit"]), /requires a value/);
  assert.throws(() => parseReleaseManifestV2Arguments([]), /missing --publisher-commit/);
});

test("a seal refuses any verification receipt short of the complete gate against the cited producer tree", async (t) => {
  const fixture = await makeManifestFixture(t);
  const options = { ...fixture, historicalManifestDigests: {} };
  const producerCommit = fixture.producerReceipt.producer.commit;
  assert.doesNotThrow(() => assertCompleteVerification(fixture.verificationReceipt, producerCommit));
  const cases = [
    ["focused run", (receipt) => { receipt.scope = "focused"; }, /focused run, not the complete gate/],
    ["single phase", (receipt) => { receipt.phases = receipt.phases.filter(({ id }) => id === "documentation"); }, /did not run the descriptor phase/],
    ["missing browser", (receipt) => { receipt.phases = receipt.phases.filter(({ id }) => id !== "browser"); }, /did not run the browser phase/],
    ["no phase list", (receipt) => { delete receipt.phases; }, /did not run/],
    ["failed phase", (receipt) => { receipt.phases[3].exit_code = 1; }, /failed unit-coverage phase/],
    ["timed-out phase", (receipt) => { receipt.phases[5].timed_out = true; }, /failed browser phase/],
    ["missing claim", (receipt) => { receipt.claims = receipt.claims.filter((claim) => claim !== "producer_derivation"); }, /does not claim producer_derivation/],
    ["no claims", (receipt) => { delete receipt.claims; }, /does not claim/],
    ["producer re-run after verify", (receipt) => { receipt.candidate.producer_commits = ["b".repeat(40)]; }, /not produced against producer commit/],
    ["no producer receipt at verify time", (receipt) => { delete receipt.candidate.producer_commits; }, /not produced against producer commit/]
  ];
  for (const [label, mutate, pattern] of cases) {
    const receipt = structuredClone(fixture.verificationReceipt);
    mutate(receipt);
    assert.throws(() => assertCompleteVerification(receipt, producerCommit), pattern, label);
    await writeFile(fixture.verificationReceiptPath, `${JSON.stringify(receipt)}\n`);
    await assert.rejects(() => buildManifestV2(options), pattern, `${label} sealed`);
  }
  // Receipts written before the scope field existed are judged by their phases and claims alone.
  const legacy = structuredClone(fixture.verificationReceipt);
  delete legacy.scope;
  assert.doesNotThrow(() => assertCompleteVerification(legacy, producerCommit));
});

test("a seal refuses a producer statement that hashes a published file differently", async (t) => {
  const fixture = await makeManifestFixture(t);
  const options = { ...fixture, historicalManifestDigests: {} };
  const readme = fileRecord("README.md", "fixture\n");
  assert.doesNotThrow(() => assertStatementMatchesInventory({ outputs: [readme] }, [readme]));
  assert.doesNotThrow(() => assertStatementMatchesInventory({}, [readme]));
  assert.throws(
    () => assertStatementMatchesInventory({ contracts: [{ ...readme, sha256: "0".repeat(64) }] }, [readme]),
    /disagree on README\.md/
  );
  const receipt = structuredClone(fixture.producerReceipt);
  receipt.producer_statement.outputs.push({ ...readme, bytes: readme.bytes + 1 });
  await writeFile(fixture.producerReceiptPath, `${JSON.stringify(receipt)}\n`);
  await assert.rejects(() => buildManifestV2(options), /disagree on README\.md/);

  // A mirrored file that the producer does export is producer-derived and is not relabelled.
  const mirrored = fileRecord("data/creedspace-bounder-manipulator-profile-v1.example.json", "{\"mirror\":true}\n");
  const exported = structuredClone(fixture.producerReceipt);
  exported.producer_statement.outputs.push(mirrored);
  await writeFile(fixture.producerReceiptPath, `${JSON.stringify(exported)}\n`);
  const manifest = await buildManifestV2(options);
  assert.equal(manifest.observations.some(({ path }) => path === mirrored.path), false);
});

test("a seal refuses a producer statement naming a contract or published output it does not pin", async (t) => {
  const fixture = await makeManifestFixture(t);
  const options = { ...fixture, historicalManifestDigests: {} };
  for (const [section, record] of [
    ["contracts", fileRecord("schemas/unsealed.schema.json", "{}\n")],
    ["outputs", fileRecord("data/unsealed.json", "{}\n")]
  ]) {
    const receipt = structuredClone(fixture.producerReceipt);
    receipt.producer_statement[section].push(record);
    const sealedContract = fixture.producerReceipt.producer_statement.contracts;
    assert.throws(() => assertStatementMatchesInventory(receipt.producer_statement, sealedContract), new RegExp(`names ${record.path.replace(".", "\\.")}, which is absent`));
    await writeFile(fixture.producerReceiptPath, `${JSON.stringify(receipt)}\n`);
    await assert.rejects(() => buildManifestV2(options), /which is absent from the publisher inventory/);
  }
  // Producer-only outputs are never published, so they are not required in the inventory.
  assert.doesNotThrow(() => assertStatementMatchesInventory({ outputs: [fileRecord("producer/fleet.json")] }, []));
});

test("a tracked public file missing from the working tree fails sealing instead of being left out", async (t) => {
  const fixture = await makeManifestFixture(t);
  // A directory allowlist is where a deletion goes unnoticed: the tree walk simply finds one
  // file fewer, while the commit that deploy-pages publishes still carries it.
  const options = { ...fixture, publicPaths: ["README.md", "VERSION", "data", "schemas"], historicalManifestDigests: {} };
  await buildManifestV2(options);
  await rm(join(fixture.root, "data", "creedspace-bounder-manipulator-profile-v1.example.json"));
  await assert.rejects(
    () => buildManifestV2(options),
    /public files tracked in commit [0-9a-f]{40} are missing from the working tree: data\/creedspace-bounder-manipulator-profile-v1\.example\.json/
  );
  await assert.rejects(
    () => assertCommitInventoryComplete(fixture.root, fixture.publisherCommit, ["README.md", "VERSION"], [fileRecord("VERSION", "1.1.0\n")]),
    /missing from the working tree: README\.md/
  );
  await assertCommitInventoryComplete(fixture.root, fixture.publisherCommit, ["VERSION"], [fileRecord("VERSION", "1.1.0\n")]);
});

test("an untracked file under a public path fails sealing with its name", async (t) => {
  const fixture = await makeManifestFixture(t);
  await writeFile(join(fixture.root, "data", "scratch.json"), "{}\n");
  await assert.rejects(
    () => buildManifestV2({ ...fixture, publicPaths: ["VERSION", "README.md", "data"], historicalManifestDigests: {} }),
    /untracked or ignored file under a public path: data\/scratch\.json/
  );
});

test("every sealed v2 manifest's inventory hash is recomputable from its files array as recorded", async () => {
  // Order is part of the recorded array, not something a verifier re-derives: v1.1.0 to v1.2.2
  // used ICU collation and later releases use code-unit order, and both verify this way.
  for (const path of Object.keys(HISTORICAL_MANIFEST_SHA256)) {
    const manifest = JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
    if (manifest.manifest_version !== "bounder-release-manifest/v2") continue;
    assert.equal(inventoryHash(manifest.files), manifest.build.public_inventory_sha256, path);
  }
  assert.equal(compareInventoryPaths("CNAME", "assets/x"), -1);
  assert.equal(compareInventoryPaths("b", "a"), 1);
  assert.equal(compareInventoryPaths("a", "a"), 0);
});
