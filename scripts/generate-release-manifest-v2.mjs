import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { canonicalPublicPaths, inspectPublicTree } from "./build-site.mjs";

export const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const PUBLISHER_REPOSITORY = "https://github.com/NellInc/Bounder";
export const HISTORICAL_MANIFEST_SHA256 = Object.freeze({
  "release/bounder-reference-v1.0.0.manifest.json": "4f01487f7c31897d8b9210c6efbd1971f1877eed510ad1d975ead72d46202e17",
  "release/bounder-reference-v1.0.1.manifest.json": "05ffe834e1f1d4d2c28980be95e12c2cb8d66bbaf89f89a379f3150be3f9b170",
  "release/bounder-reference-v1.0.2.manifest.json": "9aeabbc5da421e53535281cc67a59706ad0ccad3a67b7006dc1380977a68c785",
  "release/bounder-reference-v1.0.3.manifest.json": "656d39ffdf319e59098a0f42e52a72f62bb50855eba3e7bff5aeb228926ba7b4",
  "release/bounder-reference-v1.0.4.manifest.json": "302f5023a1769658e29ec8298e7405e2ac8762fe5bf3d805cf8ffd5fcf38d8b9",
  "release/bounder-reference-v1.1.0.manifest.json": "71dee2bdf9ab446d677d203fca8b93842a8c63b07109e86bc2fee1c07eca0556",
  "release/bounder-reference-v1.1.1.manifest.json": "6a7524407d25ff0d4d5783f07a01c76e0ee686e1107c3f10dfac6539f17ea73b",
  "release/bounder-reference-v1.1.2.manifest.json": "4cf34684204304f4d034f81111c27be86e84ffadceace544d73763e499aa553b"
});

const execFileAsync = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const compare = (left, right) => left.localeCompare(right, "en");

async function git(root, args, { encoding = "utf8", maxBuffer = 64 * 1024 * 1024 } = {}) {
  const { stdout } = await execFileAsync("/usr/bin/git", ["--no-optional-locks", "-C", root, ...args], {
    encoding,
    maxBuffer,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" }
  });
  return stdout;
}

export async function assertHistoricalManifests(root, expectedDigests = HISTORICAL_MANIFEST_SHA256) {
  for (const [path, expected] of Object.entries(expectedDigests)) {
    const bytes = await readFile(join(root, path));
    if (hash(bytes) !== expected) throw new Error(`historical manifest changed: ${path}`);
  }
  // Completeness is derived from the release directory rather than remembered by hand. A
  // manifest sealed by an earlier release but never added to the map above would otherwise stay
  // silently mutable, which is exactly the maintenance step that gets skipped.
  let sealed;
  try {
    sealed = await readdir(join(root, "release"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const name of sealed.filter((entry) => entry.endsWith(".manifest.json")).sort(compare)) {
    const path = `release/${name}`;
    if (!Object.hasOwn(expectedDigests, path)) throw new Error(`sealed manifest is not pinned as immutable: ${path}`);
  }
}

export function assertReceipt(value, expectedVersion, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== expectedVersion || value.success !== true) {
    throw new Error(`${label} is not a successful ${expectedVersion} receipt`);
  }
}

export async function fileReceipt(path, expectedVersion, label) {
  const bytes = await readFile(path);
  const value = JSON.parse(bytes.toString("utf8"));
  assertReceipt(value, expectedVersion, label);
  return { value, sha256: hash(bytes) };
}

export async function assertPublisherCommit(root, commit, files) {
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("publisher commit must be a full lowercase Git SHA");
  const type = (await git(root, ["cat-file", "-t", commit])).trim();
  if (type !== "commit") throw new Error("publisher commit does not resolve to a commit");
  for (const file of files) {
    const committed = Buffer.from(await git(root, ["show", `${commit}:${file.path}`], { encoding: null, maxBuffer: file.bytes + 1024 }));
    if (committed.byteLength !== file.bytes || hash(committed) !== file.sha256) {
      throw new Error(`publisher source differs from commit ${commit}: ${file.path}`);
    }
  }
}

export function inventoryHash(files) {
  return hash(Buffer.from(`${JSON.stringify(files)}\n`));
}

export async function buildManifestV2({
  root,
  publisherCommit,
  producerReceiptPath,
  verificationReceiptPath,
  publicPaths = canonicalPublicPaths,
  historicalManifestDigests = HISTORICAL_MANIFEST_SHA256
}) {
  await assertHistoricalManifests(root, historicalManifestDigests);
  const versionSource = await readFile(join(root, "VERSION"), "utf8");
  const releaseVersion = versionSource.endsWith("\n") ? versionSource.slice(0, -1) : "";
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(releaseVersion) || versionSource !== `${releaseVersion}\n`) {
    throw new Error("VERSION must contain one canonical release version and newline");
  }
  const [producerReceipt, verificationReceipt, publicEntries] = await Promise.all([
    fileReceipt(producerReceiptPath, "bounder-producer-derivation-verification/v1", "producer derivation"),
    fileReceipt(verificationReceiptPath, "bounder-verification/v1", "publisher verification"),
    inspectPublicTree({ root, publicPaths })
  ]);
  const statement = producerReceipt.value.producer_statement;
  if (!statement || statement.version !== "bounder-evidence-provenance/v1") throw new Error("producer receipt has no complete evidence statement");
  if (producerReceipt.value.producer.commit !== statement.producer_source.commit) throw new Error("producer receipt commit disagreement");

  const files = publicEntries.filter(({ type }) => type === "file").map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })).sort((left, right) => compare(left.path, right.path));
  await assertPublisherCommit(root, publisherCommit, files);
  if (verificationReceipt.value.candidate.publisher_commit !== publisherCommit || verificationReceipt.value.candidate.dirty !== false) {
    throw new Error("publisher verification receipt is not for the clean source commit");
  }
  const timestamp = Number((await git(root, ["show", "-s", "--format=%ct", publisherCommit])).trim());
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("publisher commit timestamp is invalid");
  const byPath = new Map(files.map((file) => [file.path, file]));
  const observation = (path, limitation) => {
    const file = byPath.get(path);
    if (!file) throw new Error(`recorded observation is missing from publisher inventory: ${path}`);
    return { path, classification: "recorded_observation", sha256: file.sha256, limitation };
  };
  return {
    manifest_version: "bounder-release-manifest/v2",
    release_version: releaseVersion,
    license: "Apache-2.0",
    generated_at: new Date(timestamp * 1000).toISOString().replace(".000Z", "Z"),
    publisher_source: { repository: PUBLISHER_REPOSITORY, commit: publisherCommit, discovery_ref: "main" },
    evidence_producers: [{
      role: "decision_producer",
      repository: statement.producer_source.repository,
      commit: statement.producer_source.commit,
      discovery_ref: "master",
      generator: `${statement.generator.entrypoint}@${statement.generator.version}`,
      inputs: statement.inputs,
      contracts: statement.contracts,
      outputs: statement.outputs,
      verification_receipt_sha256: producerReceipt.sha256
    }],
    build: {
      command: "npm run build",
      node: verificationReceipt.value.environment.node,
      public_inventory_sha256: inventoryHash(files),
      verification_receipt_sha256: verificationReceipt.sha256
    },
    deployment: { status: "unverified", reason: "No deployment was authorized for this local release candidate." },
    live_observation: { status: "unverified", reason: "Live bytes and continuity evidence require a separate authorized observation after deployment." },
    observations: [
      observation("data/bounder-fleet-evidence.v1.json", "Recorded 16-Guardian Fleet laboratory evidence; it is not the deterministic producer Fleet fixture."),
      observation("data/bounder-staging-pilot.v1.json", "Recorded 100-Guardian staging pilot; it is not current live health or deployment proof.")
    ],
    files
  };
}

export async function validateManifest(root, manifest) {
  const schema = JSON.parse(await readFile(join(root, "schemas", "bounder-release-manifest-v2.schema.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    const detail = validate.errors.map(({ instancePath, message }) => `${instancePath || "/"} ${message}`).join("; ");
    throw new Error(`release manifest v2 schema validation failed: ${detail}`);
  }
}

export function parseReleaseManifestV2Arguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!["--publisher-commit", "--producer-receipt", "--verification-receipt"].includes(name)) throw new Error(`unknown release v2 argument: ${name}`);
    const value = args[index += 1];
    if (!value) throw new Error(`${name} requires a value`);
    options[name.slice(2).replaceAll("-", "_")] = value;
  }
  for (const required of ["publisher_commit", "producer_receipt", "verification_receipt"]) if (!options[required]) throw new Error(`missing --${required.replaceAll("_", "-")}`);
  return options;
}

export async function runReleaseManifestV2Cli(args = process.argv.slice(2), logger = console) {
  const options = parseReleaseManifestV2Arguments(args);
  const manifest = await buildManifestV2({
    root: repositoryRoot,
    publisherCommit: options.publisher_commit,
    producerReceiptPath: resolve(options.producer_receipt),
    verificationReceiptPath: resolve(options.verification_receipt)
  });
  await validateManifest(repositoryRoot, manifest);
  const target = join(repositoryRoot, "release", `bounder-reference-v${manifest.release_version}.manifest.json`);
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  logger.log(`Release manifest v2: ${target}`);
  return Object.freeze({ manifest: Object.freeze(manifest), target });
}

/* c8 ignore start -- direct-entry failure plumbing is covered through the exported command API. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleaseManifestV2Cli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
