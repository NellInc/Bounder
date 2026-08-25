import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MAX_PUBLIC_ENTRIES,
  MAX_PUBLIC_FILE_BYTES,
  defaultFileSystem,
  lstatContainedPath,
  portableCollisionKey,
  resolveContainedPath,
  validateSafeRelativePath
} from "./build-site.mjs";

export const CANONICAL_INTERLOCK_REPOSITORY = "https://github.com/NellInc/Bounder";
export const CANONICAL_INTERLOCK_REF = "main";
export const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export const STRICT_GENERATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const MAX_MANIFEST_BYTES = 1024 * 1024;

const previouslyPinnedSourcePaths = Object.freeze([
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "VERSION",
  "continuity-evidence.js",
  "data/bounder-fleet-evidence.v1.json",
  "data/bounder-receipts.v1.json",
  "data/bounder-staging-pilot.v1.json",
  "data/creedspace-bounder-golden-v1.json",
  "data/creedspace-bounder-roundtrip-v1.json",
  "guides/INTEGRATION.md",
  "index.html",
  "policy-roundtrip.js",
  "schemas/bounder-resilience-evidence.v1.schema.json",
  "schemas/bounder.receipt-bundle.v1.schema.json",
  "schemas/bounder.receipt.v1.schema.json",
  "schemas/creedspace-bounder-checkpoint-v1.schema.json",
  "schemas/creedspace-bounder-envelope-v1.schema.json",
  "schemas/creedspace-bounder-policy-v1.schema.json",
  "schemas/creedspace-bounder-profile-v1.schema.json",
  "schemas/creedspace-bounder-roundtrip-v1.schema.json",
  "simulator-bootstrap.js",
  "simulator-fallback.js",
  "simulator-world.js",
  "simulator.css",
  "simulator.html",
  "simulator.js",
  "site.js",
  "staging-feed.js",
  "styles.css"
]);

const version103PinnedSourcePaths = Object.freeze([
  ...previouslyPinnedSourcePaths,
  "simulator-contracts.js"
].sort());

export const canonicalPinnedSourcePaths = Object.freeze([...version103PinnedSourcePaths]);

const version100PinnedSourcePaths = Object.freeze(
  previouslyPinnedSourcePaths.filter((path) => path !== "SECURITY.md")
);

export const historicalPinnedSourcePaths = Object.freeze({
  "1.0.0": version100PinnedSourcePaths,
  "1.0.1": previouslyPinnedSourcePaths,
  "1.0.2": previouslyPinnedSourcePaths,
  "1.0.3": version103PinnedSourcePaths
});

export const historicalManifestSha256 = Object.freeze({
  "1.0.0": "4f01487f7c31897d8b9210c6efbd1971f1877eed510ad1d975ead72d46202e17",
  "1.0.1": "05ffe834e1f1d4d2c28980be95e12c2cb8d66bbaf89f89a379f3150be3f9b170",
  "1.0.2": "9aeabbc5da421e53535281cc67a59706ad0ccad3a67b7006dc1380977a68c785",
  "1.0.3": "656d39ffdf319e59098a0f42e52a72f62bb50855eba3e7bff5aeb228926ba7b4"
});

const historicalCanonicalInterlocks = Object.freeze({
  "1.0.0": Object.freeze({
    repository: "https://github.com/NellWatson/Bounder",
    ref: "master",
    commit: "8dc18c8492f406a8c886e35a9d1e3748d9fb40bb"
  }),
  "1.0.1": Object.freeze({
    repository: CANONICAL_INTERLOCK_REPOSITORY,
    ref: CANONICAL_INTERLOCK_REF,
    commit: "73eec7a344be6d1433fc77fe520c3cbca4ed00c2"
  }),
  "1.0.2": Object.freeze({
    repository: CANONICAL_INTERLOCK_REPOSITORY,
    ref: CANONICAL_INTERLOCK_REF,
    commit: "73eec7a344be6d1433fc77fe520c3cbca4ed00c2"
  }),
  "1.0.3": Object.freeze({
    repository: CANONICAL_INTERLOCK_REPOSITORY,
    ref: CANONICAL_INTERLOCK_REF,
    commit: "7f49fd218e31f47c3528f42269e2c6287a55e26d"
  })
});

export const manifestRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const modulePath = fileURLToPath(import.meta.url);
const MANIFEST_NAME = /^bounder-reference-v(.+)\.manifest\.json$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PINNED_GIT_MODE = "100644";
const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const withBufferHeadroom = (limit) => Math.min(Number.MAX_SAFE_INTEGER, limit + 1024);

export function defaultGitExecutable(platform = process.platform) {
  if (platform === "darwin" || platform === "linux") return "/usr/bin/git";
  throw new Error(`No trusted default Git executable is configured for platform ${platform}`);
}

export function defaultGitRunner({
  root,
  args,
  maxBuffer = withBufferHeadroom(MAX_PUBLIC_FILE_BYTES),
  execFileApi = execFile,
  gitExecutable = defaultGitExecutable()
}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new TypeError("Git arguments must be an array of strings");
  }
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 1) throw new Error("Git maxBuffer must be a positive safe integer");
  if (typeof execFileApi !== "function") throw new TypeError("execFileApi must be a function");
  if (typeof gitExecutable !== "string" || !gitExecutable.startsWith("/")) {
    throw new Error("Git executable must be an absolute trusted path");
  }
  const env = {
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
  for (const name of ["HOME", "TMPDIR"]) {
    if (typeof process.env[name] === "string") env[name] = process.env[name];
  }
  return new Promise((resolvePromise, rejectPromise) => {
    execFileApi(
      gitExecutable,
      ["--no-optional-locks", "-C", resolve(root), ...args],
      {
        encoding: null,
        maxBuffer,
        timeout: 15_000,
        windowsHide: true,
        env
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          rejectPromise(error);
          return;
        }
        resolvePromise({ stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
      }
    );
  });
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort(comparePaths);
  const wanted = [...expected].sort(comparePaths);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} keys must be exactly ${wanted.join(", ")}; got ${actual.join(", ")}`);
  }
}

function parseJsonWithoutDuplicateMembers(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }

  let index = 0;
  const skipWhitespace = () => {
    while (index < text.length && /\s/u.test(text[index])) index += 1;
  };
  const readString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += text[index + 1] === "u" ? 6 : 2;
      } else if (text[index] === "\"") {
        index += 1;
        const raw = text.slice(start, index);
        return { raw, value: JSON.parse(raw) };
      } else {
        index += 1;
      }
    }
    throw new Error(`${label} contains an unterminated JSON string`);
  };
  const scanValue = (depth = 0) => {
    if (depth > 32) throw new Error(`${label} exceeds the 32-level nesting limit`);
    skipWhitespace();
    if (text[index] === "{") {
      index += 1;
      skipWhitespace();
      const members = new Set();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (index < text.length) {
        const { raw, value: member } = readString();
        if (raw !== JSON.stringify(member)) {
          throw new Error(`${label} contains an escaped or non-canonical object member name: ${raw}`);
        }
        if (members.has(member)) throw new Error(`${label} contains a duplicate object member: ${member}`);
        members.add(member);
        skipWhitespace();
        index += 1; // JSON.parse already proved this is a colon.
        scanValue(depth + 1);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        index += 1; // JSON.parse already proved this is a comma.
        skipWhitespace();
      }
      return;
    }
    if (text[index] === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      while (index < text.length) {
        scanValue(depth + 1);
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        index += 1; // JSON.parse already proved this is a comma.
      }
      return;
    }
    if (text[index] === "\"") {
      readString();
      return;
    }
    while (index < text.length && !/[\s,}\]]/u.test(text[index])) index += 1;
  };

  scanValue();
  skipWhitespace();
  if (index !== text.length) throw new Error(`${label} contains trailing JSON data`);
  return parsed;
}

export function parseStrictSemVer(value, label = "version") {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  if (value.length > 64) throw new Error(`${label} is unreasonably long`);
  const match = value.match(STRICT_SEMVER);
  if (!match) throw new Error(`${label} must be canonical SemVer 2.0.0: ${JSON.stringify(value)}`);
  const parts = match.slice(1, 4).map((component) => BigInt(component));
  const prerelease = match[4] === undefined ? null : Object.freeze(match[4].split("."));
  return Object.freeze({ value, parts: Object.freeze(parts), prerelease, build: match[5] ?? null });
}

function coerceSemVer(value, label) {
  if (typeof value === "string") return parseStrictSemVer(value, label);
  if (value && typeof value === "object" && typeof value.value === "string") return parseStrictSemVer(value.value, label);
  throw new TypeError(`${label} must be a SemVer string or parsed SemVer`);
}

export function compareSemVer(left, right) {
  const leftVersion = coerceSemVer(left, "left version");
  const rightVersion = coerceSemVer(right, "right version");
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.parts[index] < rightVersion.parts[index]) return -1;
    if (leftVersion.parts[index] > rightVersion.parts[index]) return 1;
  }
  if (leftVersion.prerelease === null || rightVersion.prerelease === null) {
    if (leftVersion.prerelease === rightVersion.prerelease) return 0;
    return leftVersion.prerelease === null ? 1 : -1;
  }
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function validateGeneratedAt(value) {
  if (typeof value !== "string" || !STRICT_GENERATED_AT.test(value)) {
    throw new Error(`generated_at must be UTC RFC 3339 with whole seconds: ${JSON.stringify(value)}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().replace(".000Z", "Z") !== value) {
    throw new Error(`generated_at is not a real canonical timestamp: ${value}`);
  }
  return value;
}

export function resolveGeneratedAt({ generatedAt, sourceDateEpoch, now = () => new Date() } = {}) {
  let value = generatedAt;
  if (value === undefined && sourceDateEpoch !== undefined) {
    if (typeof sourceDateEpoch !== "string" || !/^(0|[1-9]\d*)$/.test(sourceDateEpoch)) {
      throw new Error(`SOURCE_DATE_EPOCH must be a canonical non-negative integer string: ${sourceDateEpoch}`);
    }
    const seconds = Number(sourceDateEpoch);
    if (!Number.isSafeInteger(seconds)) throw new Error(`SOURCE_DATE_EPOCH is outside the safe integer range: ${sourceDateEpoch}`);
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.valueOf())) throw new Error(`SOURCE_DATE_EPOCH is outside the supported date range: ${sourceDateEpoch}`);
    value = date.toISOString().replace(".000Z", "Z");
  }
  if (value === undefined) {
    const date = now();
    if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new Error("now() must return a valid Date");
    value = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return validateGeneratedAt(value);
}

export function validateCanonicalInterlock(value, expected = {
  repository: CANONICAL_INTERLOCK_REPOSITORY,
  ref: CANONICAL_INTERLOCK_REF
}) {
  assertExactKeys(value, ["repository", "ref", "commit"], "canonical_interlock");
  if (value.repository !== expected.repository) {
    throw new Error(`canonical_interlock.repository must be ${expected.repository}`);
  }
  if (value.ref !== expected.ref) {
    throw new Error(`canonical_interlock.ref must be ${expected.ref}`);
  }
  if (typeof value.commit !== "string" || !COMMIT.test(value.commit)) {
    throw new Error("canonical_interlock.commit must be a lowercase 40-digit Git commit SHA");
  }
  if (expected.commit !== undefined && value.commit !== expected.commit) {
    throw new Error(`canonical_interlock.commit must preserve the historical value ${expected.commit}`);
  }
  return value;
}

export function validatePathInventory(paths, label = "manifest paths") {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error(`${label} must be a non-empty array`);
  if (paths.length > MAX_PUBLIC_ENTRIES) throw new Error(`${label} exceeds the ${MAX_PUBLIC_ENTRIES}-entry limit`);
  const registry = new Map();
  for (const path of paths) {
    validateSafeRelativePath(path, label);
    const key = portableCollisionKey(path);
    const existing = registry.get(key);
    if (existing) throw new Error(`${label} contain duplicate or case-colliding paths: ${existing} and ${path}`);
    registry.set(key, path);
  }
  const sorted = [...paths].sort(comparePaths);
  if (JSON.stringify(sorted) !== JSON.stringify(paths)) throw new Error(`${label} must be in deterministic lexical order`);
  return paths;
}

export function pinnedEvidenceAndSchemaPaths(manifest) {
  assertPlainObject(manifest, "release manifest");
  if (!Array.isArray(manifest.files)) throw new TypeError("release manifest files must be an array");
  const paths = manifest.files.map((artifact, index) => {
    assertPlainObject(artifact, `release manifest files[${index}]`);
    return artifact.path;
  });
  validatePathInventory(paths, "release manifest paths");
  const selected = paths.filter((path) => path.startsWith("data/") || path.startsWith("schemas/"));
  if (!selected.length) throw new Error("release manifest pins no evidence or schema artifacts");
  return Object.freeze(selected);
}

export function expectedPinnedPathsForVersion(version) {
  parseStrictSemVer(version);
  return historicalPinnedSourcePaths[version] ?? canonicalPinnedSourcePaths;
}

export function validateManifestStructure(manifest, {
  expectedVersion,
  expectedPaths,
  expectedInterlock,
  maxFileBytes = MAX_PUBLIC_FILE_BYTES
} = {}) {
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error("maxFileBytes must be a positive safe integer");
  assertExactKeys(manifest, ["version", "license", "generated_at", "canonical_interlock", "files"], "manifest");
  parseStrictSemVer(manifest.version, "manifest.version");
  if (expectedVersion !== undefined && manifest.version !== expectedVersion) {
    throw new Error(`Manifest version ${manifest.version} does not match expected version ${expectedVersion}`);
  }
  if (manifest.license !== "Apache-2.0") throw new Error("Manifest license must be Apache-2.0");
  validateGeneratedAt(manifest.generated_at);
  validateCanonicalInterlock(manifest.canonical_interlock, expectedInterlock);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("manifest.files must be a non-empty array");
  if (manifest.files.length > MAX_PUBLIC_ENTRIES) throw new Error(`manifest.files exceeds the ${MAX_PUBLIC_ENTRIES}-entry limit`);

  const paths = [];
  for (const [index, artifact] of manifest.files.entries()) {
    assertExactKeys(artifact, ["path", "bytes", "sha256"], `manifest.files[${index}]`);
    validateSafeRelativePath(artifact.path, `manifest.files[${index}].path`);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || artifact.bytes > maxFileBytes) {
      throw new Error(`manifest.files[${index}].bytes must be a safe integer between 0 and ${maxFileBytes}`);
    }
    if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) {
      throw new Error(`manifest.files[${index}].sha256 must be a lowercase SHA-256 digest`);
    }
    paths.push(artifact.path);
  }
  validatePathInventory(paths);

  if (expectedPaths !== undefined) {
    validatePathInventory(expectedPaths, "expected manifest paths");
    if (JSON.stringify(paths) !== JSON.stringify(expectedPaths)) {
      throw new Error("Manifest file inventory does not match the required source list");
    }
  }
  return manifest;
}

async function readJsonContainedRecord(root, relativePath, fsApi, label) {
  const { absolutePath, info } = await lstatContainedPath(root, relativePath, fsApi, label);
  if (!info.isFile()) throw new Error(`${label} must be a regular non-symlink file: ${relativePath}`);
  if (!Number.isSafeInteger(info.nlink) || info.nlink !== 1) throw new Error(`${label} may not be a hard link: ${relativePath}`);
  if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > MAX_MANIFEST_BYTES) {
    throw new Error(`${label} must be between 1 and ${MAX_MANIFEST_BYTES} bytes: ${relativePath}`);
  }

  let bytes;
  try {
    bytes = await fsApi.readFile(absolutePath);
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${relativePath}`, { cause: error });
  }
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length !== info.size) throw new Error(`${label} changed while being read: ${relativePath}`);
  return {
    absolutePath,
    bytes,
    value: parseJsonWithoutDuplicateMembers(bytes.toString("utf8"), `${label} ${relativePath}`)
  };
}

async function readJsonContained(root, relativePath, fsApi, label) {
  return (await readJsonContainedRecord(root, relativePath, fsApi, label)).value;
}

async function lstatOrNull(path, fsApi) {
  try {
    return await fsApi.lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isSameFileIdentity(left, right) {
  return Boolean(
    left
    && right
    && left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
  );
}

export async function inspectPinnedSource({ root, path, fsApi = defaultFileSystem, maxFileBytes = MAX_PUBLIC_FILE_BYTES }) {
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error("maxFileBytes must be a positive safe integer");
  const { absolutePath, info } = await lstatContainedPath(root, path, fsApi, "pinned source path");
  if (!info.isFile()) throw new Error(`Pinned source must be a regular non-symlink file: ${path}`);
  if (!Number.isSafeInteger(info.nlink) || info.nlink !== 1) throw new Error(`Pinned source may not be a hard link: ${path}`);
  if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > maxFileBytes) {
    throw new Error(`Pinned source violates the ${maxFileBytes}-byte limit: ${path}`);
  }
  let bytes = await fsApi.readFile(absolutePath);
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length !== info.size) throw new Error(`Pinned source changed while being read: ${path}`);
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function verifyManifestFiles(manifest, {
  root = manifestRoot,
  fsApi = defaultFileSystem,
  maxFileBytes = MAX_PUBLIC_FILE_BYTES
} = {}) {
  for (const artifact of manifest.files) {
    const actual = await inspectPinnedSource({ root, path: artifact.path, fsApi, maxFileBytes });
    if (actual.bytes !== artifact.bytes) throw new Error(`${artifact.path} byte count drifted`);
    if (actual.sha256 !== artifact.sha256) throw new Error(`${artifact.path} hash drifted`);
  }
  return manifest;
}

export async function validateManifestFile({
  root = manifestRoot,
  version,
  expectedPaths = expectedPinnedPathsForVersion(version),
  fsApi = defaultFileSystem,
  verifyFiles = true,
  maxFileBytes = MAX_PUBLIC_FILE_BYTES
}) {
  parseStrictSemVer(version);
  const relativePath = `release/bounder-reference-v${version}.manifest.json`;
  const manifest = await readJsonContained(root, relativePath, fsApi, "release manifest");
  validateManifestStructure(manifest, { expectedVersion: version, expectedPaths, maxFileBytes });
  if (verifyFiles) await verifyManifestFiles(manifest, { root, fsApi, maxFileBytes });
  return manifest;
}

export async function selectBaseline({
  root = manifestRoot,
  version,
  fsApi = defaultFileSystem,
  expectedHistoricalDigests = historicalManifestSha256
}) {
  const targetVersion = parseStrictSemVer(version, "target version");
  const { absolutePath: releaseDirectory, info } = await lstatContainedPath(root, "release", fsApi, "release directory");
  if (!info.isDirectory()) throw new Error("release directory must be a real directory");
  const names = (await fsApi.readdir(releaseDirectory)).sort(comparePaths);
  const candidates = [];

  for (const name of names) {
    const match = name.match(MANIFEST_NAME);
    if (!match) {
      if (name.startsWith("bounder-reference-v") || name.endsWith(".manifest.json")) {
        throw new Error(`Malformed release manifest filename: ${name}`);
      }
      continue;
    }
    let candidateVersion;
    try {
      candidateVersion = parseStrictSemVer(match[1], `manifest filename ${name}`);
    } catch (error) {
      throw new Error(`Malformed release manifest filename: ${name}`, { cause: error });
    }
    if (compareSemVer(candidateVersion, targetVersion) >= 0) {
      throw new Error(`Release manifest ${name} is not strictly lower than target ${version}`);
    }
    candidates.push({ name, version: candidateVersion });
  }

  candidates.sort((left, right) => compareSemVer(right.version, left.version));
  if (!candidates.length) throw new Error(`No strictly lower release manifest is available as a baseline for ${version}`);
  const history = [];
  for (const candidate of candidates) {
    const relativePath = `release/${candidate.name}`;
    const record = await readJsonContainedRecord(root, relativePath, fsApi, "historical release manifest");
    validateManifestStructure(record.value, {
      expectedVersion: candidate.version.value,
      expectedPaths: expectedPinnedPathsForVersion(candidate.version.value),
      expectedInterlock: expectedHistoricalDigests === null
        ? undefined
        : historicalCanonicalInterlocks[candidate.version.value]
    });
    if (expectedHistoricalDigests !== null) {
      assertPlainObject(expectedHistoricalDigests, "expected historical manifest digests");
      const expectedDigest = expectedHistoricalDigests[candidate.version.value];
      if (typeof expectedDigest !== "string" || !SHA256.test(expectedDigest)) {
        throw new Error(`No immutable historical manifest digest is registered for ${candidate.version.value}`);
      }
      const actualDigest = createHash("sha256").update(record.bytes).digest("hex");
      if (actualDigest !== expectedDigest) {
        throw new Error(`Historical release manifest ${candidate.name} differs from its immutable digest`);
      }
    }
    history.push({
      path: record.absolutePath,
      relativePath,
      manifest: record.value,
      version: candidate.version.value,
      bytes: record.bytes
    });
  }
  const selected = history[0];
  return {
    ...selected,
    history: Object.freeze(history)
  };
}

async function createManifestFiles({ root, requiredPaths, fsApi, maxFileBytes }) {
  const paths = [...requiredPaths].sort(comparePaths);
  validatePathInventory(paths, "required pinned source paths");
  const files = [];
  for (const path of paths) files.push(await inspectPinnedSource({ root, path, fsApi, maxFileBytes }));
  return files;
}

function validatePinnedTreeEntry(result, path) {
  const output = Buffer.from(result?.stdout ?? []);
  const terminator = output.indexOf(0);
  if (terminator < 0 || terminator !== output.length - 1 || output.indexOf(0, terminator + 1) !== -1) {
    throw new Error(`canonical_interlock.commit must contain exactly one pinned source entry for ${path}`);
  }
  const record = output.subarray(0, terminator);
  const tab = record.indexOf(0x09);
  if (tab < 0) throw new Error(`canonical_interlock.commit returned a malformed tree entry for ${path}`);
  const metadata = record.subarray(0, tab).toString("ascii").split(" ");
  const actualPath = record.subarray(tab + 1);
  if (metadata.length !== 3 || !COMMIT.test(metadata[2]) || !actualPath.equals(Buffer.from(path, "utf8"))) {
    throw new Error(`canonical_interlock.commit returned a malformed or mismatched tree entry for ${path}`);
  }
  const [mode, type] = metadata;
  if (mode !== PINNED_GIT_MODE || type !== "blob") {
    throw new Error(
      `Pinned source ${path} must be an ordinary non-executable Git blob with mode ${PINNED_GIT_MODE}; got ${mode} ${type}`
    );
  }
}

export async function verifyPinnedSourcesAtCommit({
  root = manifestRoot,
  commit,
  files,
  gitRunner = defaultGitRunner,
  maxFileBytes = MAX_PUBLIC_FILE_BYTES
}) {
  if (typeof commit !== "string" || !COMMIT.test(commit)) {
    throw new Error("canonical_interlock.commit must be a lowercase 40-digit Git commit SHA");
  }
  if (!Array.isArray(files) || files.length === 0) throw new Error("Pinned commit files must be a non-empty array");
  if (typeof gitRunner !== "function") throw new TypeError("gitRunner must be a function");
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error("maxFileBytes must be a positive safe integer");

  const paths = [];
  for (const [index, artifact] of files.entries()) {
    assertExactKeys(artifact, ["path", "bytes", "sha256"], `pinned commit files[${index}]`);
    validateSafeRelativePath(artifact.path, `pinned commit files[${index}].path`);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || artifact.bytes > maxFileBytes) {
      throw new Error(`pinned commit files[${index}].bytes must be between 0 and ${maxFileBytes}`);
    }
    if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) {
      throw new Error(`pinned commit files[${index}].sha256 must be a lowercase SHA-256 digest`);
    }
    paths.push(artifact.path);
  }
  validatePathInventory(paths, "pinned commit paths");

  let typeResult;
  try {
    typeResult = await gitRunner({
      root: resolve(root),
      args: ["cat-file", "-t", commit],
      maxBuffer: 64
    });
  } catch (error) {
    throw new Error(`canonical_interlock.commit does not resolve locally to a commit: ${commit}`, { cause: error });
  }
  if (Buffer.from(typeResult?.stdout ?? []).toString("utf8") !== "commit\n") {
    throw new Error(`canonical_interlock.commit does not resolve locally to a commit: ${commit}`);
  }

  for (const artifact of files) {
    let treeResult;
    try {
      treeResult = await gitRunner({
        root: resolve(root),
        args: ["ls-tree", "-z", "--full-tree", commit, "--", `:(literal)${artifact.path}`],
        maxBuffer: 8192
      });
    } catch (error) {
      throw new Error(
        `canonical_interlock.commit does not contain readable pinned source ${artifact.path}: ${commit}`,
        { cause: error }
      );
    }
    validatePinnedTreeEntry(treeResult, artifact.path);

    let committed;
    try {
      const result = await gitRunner({
        root: resolve(root),
        args: ["cat-file", "blob", `${commit}:${artifact.path}`],
        maxBuffer: withBufferHeadroom(maxFileBytes)
      });
      committed = Buffer.from(result?.stdout ?? []);
    } catch (error) {
      throw new Error(
        `canonical_interlock.commit does not contain readable pinned source ${artifact.path}: ${commit}`,
        { cause: error }
      );
    }
    if (committed.length > maxFileBytes) {
      throw new Error(`Committed pinned source exceeds the ${maxFileBytes}-byte limit: ${artifact.path}`);
    }
    const committedHash = createHash("sha256").update(committed).digest("hex");
    if (committed.length !== artifact.bytes || committedHash !== artifact.sha256) {
      throw new Error(`Pinned source ${artifact.path} differs from canonical_interlock.commit ${commit}`);
    }
  }
  return files;
}

export async function generateReleaseManifest({
  root = manifestRoot,
  requiredPaths = canonicalPinnedSourcePaths,
  generatedAt,
  sourceDateEpoch = process.env.SOURCE_DATE_EPOCH,
  canonicalInterlock,
  fsApi = defaultFileSystem,
  gitRunner = defaultGitRunner,
  expectedHistoricalDigests = historicalManifestSha256,
  maxFileBytes = MAX_PUBLIC_FILE_BYTES,
  now,
  logger = console
} = {}) {
  const absoluteRoot = resolve(root);
  const { absolutePath: versionPath, info: versionInfo } = await lstatContainedPath(
    absoluteRoot,
    "VERSION",
    fsApi,
    "VERSION path"
  );
  if (!versionInfo.isFile() || versionInfo.size > 128) throw new Error("VERSION must be a small regular non-symlink file");
  if (!Number.isSafeInteger(versionInfo.nlink) || versionInfo.nlink !== 1) throw new Error("VERSION may not be a hard link");
  const versionBytes = await fsApi.readFile(versionPath);
  if (Buffer.byteLength(versionBytes) !== versionInfo.size) throw new Error("VERSION changed while being read");
  const versionText = Buffer.from(versionBytes).toString("utf8");
  const version = versionText.endsWith("\n") ? versionText.slice(0, -1) : versionText;
  if (versionText !== `${version}\n`) throw new Error("VERSION must contain exactly one canonical SemVer followed by a newline");
  parseStrictSemVer(version);
  if (!Array.isArray(requiredPaths)) throw new TypeError("requiredPaths must be an array");
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error("maxFileBytes must be a positive safe integer");

  const { absolutePath: releaseDirectory, info: releaseInfo } = await lstatContainedPath(
    absoluteRoot,
    "release",
    fsApi,
    "release directory"
  );
  if (!releaseInfo.isDirectory()) throw new Error("release directory must be a real directory");
  const targetRelative = `release/bounder-reference-v${version}.manifest.json`;
  const target = resolveContainedPath(absoluteRoot, targetRelative, "target manifest path");
  if (await lstatOrNull(target, fsApi)) throw new Error(`Release manifest target already exists: ${targetRelative}`);
  const initialReleaseInventory = (await fsApi.readdir(releaseDirectory)).sort(comparePaths);

  const baseline = await selectBaseline({
    root: absoluteRoot,
    version,
    fsApi,
    expectedHistoricalDigests
  });
  for (const historical of baseline.history) {
    const current = await fsApi.readFile(historical.path);
    if (!Buffer.from(current).equals(Buffer.from(historical.bytes))) {
      throw new Error(`Historical release manifest ${historical.relativePath} changed after validation`);
    }
  }
  if (canonicalInterlock === undefined) {
    throw new Error("canonical_interlock must be supplied explicitly for a new release");
  }
  const interlock = canonicalInterlock;
  validateCanonicalInterlock(interlock);
  const files = await createManifestFiles({ root: absoluteRoot, requiredPaths, fsApi, maxFileBytes });
  await verifyPinnedSourcesAtCommit({
    root: absoluteRoot,
    commit: interlock.commit,
    files,
    gitRunner,
    maxFileBytes
  });
  const expectedPaths = [...requiredPaths].sort(comparePaths);
  const resolvedGeneratedAt = resolveGeneratedAt({ generatedAt, sourceDateEpoch, now });
  const latestHistoricalTimestamp = baseline.history.reduce(
    (latest, historical) => historical.manifest.generated_at > latest
      ? historical.manifest.generated_at
      : latest,
    baseline.history[0].manifest.generated_at
  );
  if (resolvedGeneratedAt < latestHistoricalTimestamp) {
    throw new Error(
      `generated_at ${resolvedGeneratedAt} may not precede historical release timestamp ${latestHistoricalTimestamp}`
    );
  }
  const manifest = {
    version,
    license: "Apache-2.0",
    generated_at: resolvedGeneratedAt,
    canonical_interlock: { ...interlock },
    files
  };
  validateManifestStructure(manifest, { expectedVersion: version, expectedPaths, maxFileBytes });
  await verifyManifestFiles(manifest, { root: absoluteRoot, fsApi, maxFileBytes });

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const stageDirectory = await fsApi.mkdtemp(join(absoluteRoot, ".bounder-manifest-stage-"));
  const temporary = join(stageDirectory, "manifest.json");
  let failure;
  let linked = false;
  let publishedIdentity;
  let stageRemoved = false;
  try {
    await fsApi.writeFile(temporary, serialized, { flag: "wx", mode: 0o644 });
    const staged = await fsApi.readFile(temporary);
    if (!Buffer.from(staged).equals(Buffer.from(serialized))) throw new Error("Staged release manifest failed its byte-for-byte verification");
    try {
      await fsApi.link(temporary, target);
      linked = true;
      const [temporaryInfo, targetInfo] = await Promise.all([
        fsApi.lstat(temporary),
        fsApi.lstat(target)
      ]);
      if (!isSameFileIdentity(temporaryInfo, targetInfo)) {
        throw new Error("Release manifest target ownership was lost after publication");
      }
      publishedIdentity = targetInfo;
    } catch (error) {
      try {
        const [temporaryInfo, targetInfo] = await Promise.all([
          fsApi.lstat(temporary),
          lstatOrNull(target, fsApi)
        ]);
        linked = isSameFileIdentity(temporaryInfo, targetInfo);
        if (linked) publishedIdentity = targetInfo;
      } catch (inspectionError) {
        throw new AggregateError(
          [error, inspectionError],
          "Release manifest link failed and ownership of the target could not be inspected"
        );
      }
      throw error;
    }
    const published = await fsApi.readFile(target);
    if (!Buffer.from(published).equals(Buffer.from(serialized))) throw new Error("Published release manifest failed its byte-for-byte verification");
    const finalVersion = await fsApi.readFile(versionPath);
    if (!Buffer.from(finalVersion).equals(Buffer.from(versionBytes))) throw new Error("VERSION changed during release manifest publication");
    await verifyManifestFiles(manifest, { root: absoluteRoot, fsApi, maxFileBytes });
    for (const historical of baseline.history) {
      const finalHistorical = await fsApi.readFile(historical.path);
      if (!Buffer.from(finalHistorical).equals(Buffer.from(historical.bytes))) {
        throw new Error(`Historical release manifest ${historical.relativePath} changed during release manifest publication`);
      }
    }
    const expectedReleaseInventory = [...initialReleaseInventory, targetRelative.slice("release/".length)].sort(comparePaths);
    const finalReleaseInventory = (await fsApi.readdir(releaseDirectory)).sort(comparePaths);
    if (JSON.stringify(finalReleaseInventory) !== JSON.stringify(expectedReleaseInventory)) {
      throw new Error("Release inventory changed during release manifest publication");
    }
    const finalPublished = await fsApi.readFile(target);
    if (!Buffer.from(finalPublished).equals(Buffer.from(serialized))) {
      throw new Error("Published release manifest failed its final byte-for-byte verification");
    }
    await fsApi.unlink(temporary);
    const [remainingTemporary, finalTargetInfo] = await Promise.all([
      lstatOrNull(temporary, fsApi),
      lstatOrNull(target, fsApi)
    ]);
    if (remainingTemporary) throw new Error("Manifest staging link remained after unlink");
    if (!isSameFileIdentity(publishedIdentity, finalTargetInfo)) {
      throw new Error("Release manifest target ownership was lost while removing its staging link");
    }
    if (!Number.isSafeInteger(finalTargetInfo.nlink) || finalTargetInfo.nlink !== 1) {
      throw new Error("Published release manifest must have exactly one filesystem link");
    }
    await fsApi.rmdir(stageDirectory);
    stageRemoved = true;
  } catch (error) {
    const errors = [];
    if (linked) {
      try {
        const targetInfo = await lstatOrNull(target, fsApi);
        if (!isSameFileIdentity(publishedIdentity, targetInfo)) {
          linked = false;
          errors.push(new Error("Release manifest target ownership was lost; the foreign replacement was preserved"));
        } else {
          try {
            await fsApi.unlink(target);
            linked = false;
          } catch (cleanupError) {
            const remaining = await lstatOrNull(target, fsApi);
            if (!remaining) linked = false;
            else if (!isSameFileIdentity(publishedIdentity, remaining)) {
              linked = false;
              errors.push(new Error("Release manifest target ownership was lost during rollback; the foreign replacement was preserved", { cause: cleanupError }));
            } else {
              errors.push(cleanupError);
            }
          }
        }
      } catch (inspectionError) {
        errors.push(new Error("Release manifest target ownership could not be verified for rollback", { cause: inspectionError }));
      }
    }
    const primary = error?.code === "EEXIST" && !linked && await lstatOrNull(target, fsApi)
      ? new Error(`Release manifest target already exists: ${targetRelative}`, { cause: error })
      : error;
    failure = errors.length ? new AggregateError([primary, ...errors], "Release manifest publication and rollback failed") : primary;
  } finally {
    if (!stageRemoved) {
      try {
        await fsApi.rm(stageDirectory, { recursive: true, force: true });
        stageRemoved = true;
      } catch (error) {
        failure = failure
          ? new AggregateError([failure, error], "Release manifest generation and cleanup failed")
          : error;
      }
    }
  }

  if (failure) throw failure;
  try {
    logger?.log?.(`Wrote ${targetRelative} with ${files.length} pinned files`);
  } catch {
    // A diagnostic sink must never turn a published manifest into a failed generation.
  }
  return { manifest, target };
}

export function isMainModule(argvPath = process.argv[1]) {
  if (!argvPath) return false;
  return pathToFileURL(resolve(argvPath)).href === pathToFileURL(modulePath).href;
}

export async function runReleaseManifestCli({
  generate = generateReleaseManifest,
  env = process.env,
  fsApi = Object.freeze({ ...nodeFs }),
  logger = console,
  processApi = process
} = {}) {
  try {
    const commit = env?.BOUNDER_CANONICAL_COMMIT;
    if (typeof commit !== "string" || !COMMIT.test(commit)) {
      throw new Error("BOUNDER_CANONICAL_COMMIT must be the exact lowercase 40-digit source commit SHA");
    }
    await generate({
      fsApi,
      canonicalInterlock: {
        repository: CANONICAL_INTERLOCK_REPOSITORY,
        ref: CANONICAL_INTERLOCK_REF,
        commit
      }
    });
    return 0;
  } catch (error) {
    processApi.exitCode = 1;
    try {
      logger?.error?.(error);
    } catch {
      // A broken diagnostic sink must not hide the failing process status.
    }
    return 1;
  }
}

if (isMainModule()) {
  await runReleaseManifestCli();
}
