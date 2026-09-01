import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  HISTORICAL_MANIFEST_SHA256,
  assertHistoricalManifests,
  assertPublisherCommit,
  assertReceipt,
  buildManifestV2,
  fileReceipt,
  inventoryHash,
  parseReleaseManifestV2Arguments,
  validateManifest
} from "../scripts/generate-release-manifest-v2.mjs";

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
    "data/bounder-staging-pilot.v1.json": "{}\n"
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
    producer: { commit: producerCommit },
    producer_statement: {
      version: "bounder-evidence-provenance/v1",
      producer_source: { repository: "https://github.com/NellInc/Bounder-from-org", commit: producerCommit },
      generator: { entrypoint: "scripts/export-website-artifacts.py", version: "1" },
      inputs: [producerRecord],
      contracts: [producerRecord],
      outputs: [producerRecord]
    }
  };
  const verificationReceipt = {
    version: "bounder-verification/v1",
    success: true,
    candidate: { publisher_commit: publisherCommit, dirty: false },
    environment: { node: "v22.0.0" }
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
    if (path.endsWith("v1.1.0.manifest.json")) {
      assert.equal(historical.manifest_version, "bounder-release-manifest/v2", `${path} lost its original v2 identity`);
    } else {
      assert.equal(Object.hasOwn(historical, "manifest_version"), false, `${path} history was rewritten as v2`);
    }
  }
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
  assert.equal(manifest.observations.length, 2);
  assert.equal(manifest.files.length, fixture.publicPaths.length);
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
  await writeFile(fixture.producerReceiptPath, `${JSON.stringify(fixture.producerReceipt)}\n`);

  const writeVerification = async (mutate) => {
    const receipt = structuredClone(fixture.verificationReceipt);
    mutate(receipt);
    await writeFile(fixture.verificationReceiptPath, `${JSON.stringify(receipt)}\n`);
  };
  await writeVerification((receipt) => { receipt.candidate.dirty = true; });
  await assert.rejects(() => buildManifestV2(options), /clean source commit/);
  await writeFile(fixture.verificationReceiptPath, `${JSON.stringify(fixture.verificationReceipt)}\n`);
  await assert.rejects(() => buildManifestV2({ ...options, publicPaths: ["VERSION", "README.md"] }), /recorded observation is missing/);

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
