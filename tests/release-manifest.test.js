import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_INTERLOCK_REF,
  CANONICAL_INTERLOCK_REPOSITORY,
  canonicalPinnedSourcePaths,
  compareSemVer,
  defaultGitExecutable,
  defaultGitRunner,
  expectedPinnedPathsForVersion,
  generateReleaseManifest,
  historicalManifestSha256,
  parseStrictSemVer,
  pinnedEvidenceAndSchemaPaths,
  resolveGeneratedAt,
  runReleaseManifestCli,
  selectBaseline,
  validateManifestFile,
  validateManifestStructure,
  verifyPinnedSourcesAtCommit
} from "../scripts/generate-release-manifest.js";
import { MAX_PUBLIC_FILE_BYTES, defaultFileSystem } from "../scripts/build-site.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const canonicalInterlock = Object.freeze({
  repository: CANONICAL_INTERLOCK_REPOSITORY,
  ref: CANONICAL_INTERLOCK_REF,
  commit: "1".repeat(40)
});
const quietLogger = Object.freeze({ log() {}, warn() {} });
const fixtureGitRunner = async ({ root, args }) => {
  if (args[0] === "cat-file" && args[1] === "-t") {
    return { stdout: Buffer.from("commit\n"), stderr: Buffer.alloc(0) };
  }
  if (args[0] === "ls-tree") {
    const literalPath = args.at(-1);
    assert.match(literalPath, /^:\(literal\)/);
    const path = literalPath.slice(10);
    return {
      stdout: Buffer.from(`100644 blob ${"a".repeat(40)}\t${path}\0`),
      stderr: Buffer.alloc(0)
    };
  }
  if (args[0] === "cat-file" && args[1] === "blob") {
    const separator = args[2].indexOf(":");
    const path = args[2].slice(separator + 1);
    return { stdout: await fs.readFile(join(root, path)), stderr: Buffer.alloc(0) };
  }
  throw new Error(`Unexpected fixture Git arguments: ${JSON.stringify(args)}`);
};
const generateManifest = (options) => generateReleaseManifest({
  canonicalInterlock,
  gitRunner: fixtureGitRunner,
  expectedHistoricalDigests: null,
  ...options
});
const selectFixtureBaseline = (options) => selectBaseline({
  expectedHistoricalDigests: null,
  ...options
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artifactFor = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });

async function committedFixture(path = "LICENSE") {
  const root = fileURLToPath(repositoryRoot);
  const { stdout: headBytes } = await defaultGitRunner({
    root,
    args: ["rev-parse", "--verify", "HEAD"],
    maxBuffer: 64
  });
  const commit = headBytes.toString("utf8").trim();
  const { stdout: bytes } = await defaultGitRunner({
    root,
    args: ["cat-file", "blob", `${commit}:${path}`],
    maxBuffer: MAX_PUBLIC_FILE_BYTES + 1024
  });
  return { root, commit, path, bytes };
}

function manifestFor(version, {
  paths = ["README.md"],
  interlock = canonicalInterlock,
  generatedAt = "2026-08-20T12:34:56Z"
} = {}) {
  return {
    version,
    license: "Apache-2.0",
    generated_at: generatedAt,
    canonical_interlock: { ...interlock },
    files: [...paths].sort().map((path) => ({ path, bytes: 1, sha256: "a".repeat(64) }))
  };
}

async function writeJson(path, value) {
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeBaseline(root, version, options = {}) {
  await writeJson(
    join(root, "release", `bounder-reference-v${version}.manifest.json`),
    manifestFor(version, { paths: expectedPinnedPathsForVersion(version), ...options })
  );
}

async function makeFixture({ version = "1.0.3", baselines = ["1.0.2"] } = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), "bounder-manifest-test-"));
  await fs.mkdir(join(root, "release"));
  await fs.writeFile(join(root, "VERSION"), `${version}\n`);
  await fs.writeFile(join(root, "README.md"), "fixture readme\n");
  await fs.writeFile(join(root, "simulator-contracts.js"), "export const fixture = true;\n");
  for (const baseline of baselines) await writeBaseline(root, baseline);
  return root;
}

async function assertNoManifestDebris(root) {
  const [rootNames, releaseNames] = await Promise.all([fs.readdir(root), fs.readdir(join(root, "release"))]);
  assert.equal(
    [...rootNames, ...releaseNames].some((name) => name.startsWith(".bounder-manifest-stage-")),
    false,
    "manifest stage leaked"
  );
}

test("strict SemVer parsing and precedence cover release, prerelease, build, and large-number boundaries", () => {
  for (const version of [
    "0.0.0",
    "1.2.3",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-0.3.7",
    "1.0.0-x.7.z.92",
    "1.0.0+build.1",
    "90071992547409930.0.0"
  ]) {
    assert.equal(parseStrictSemVer(version).value, version);
  }
  for (const version of [
    "",
    "01.0.0",
    "1.00.0",
    "1.0",
    "1.0.0-01",
    "1.0.0-alpha..1",
    "1.0.0+",
    "v1.0.0",
    "1.0.0\n",
    `1.${"9".repeat(65)}.0`
  ]) {
    assert.throws(() => parseStrictSemVer(version), /SemVer|long/);
  }

  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1"
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareSemVer(ordered[index - 1], ordered[index]), -1);
    assert.equal(compareSemVer(ordered[index], ordered[index - 1]), 1);
  }
  assert.equal(compareSemVer("1.0.0+one", "1.0.0+two"), 0, "build metadata changed precedence");
});

test("manifest structure rejects malformed provenance, timestamps, hashes, sizes, paths, and incomplete inventories", () => {
  const expectedPaths = ["README.md", "simulator-contracts.js"];
  const valid = manifestFor("1.0.3", { paths: expectedPaths });
  assert.equal(validateManifestStructure(valid, { expectedVersion: "1.0.3", expectedPaths }), valid);

  const mutations = [
    ["wrong repository", (value) => { value.canonical_interlock.repository = "https://github.com/NellWatson/Bounder"; }, /repository/],
    ["non-HTTPS repository", (value) => { value.canonical_interlock.repository = "http://github.com/NellInc/Bounder"; }, /repository/],
    ["wrong ref", (value) => { value.canonical_interlock.ref = "master"; }, /ref/],
    ["malformed commit", (value) => { value.canonical_interlock.commit = "A".repeat(40); }, /commit/],
    ["extra provenance key", (value) => { value.canonical_interlock.owner = "NellInc"; }, /keys/],
    ["timestamp milliseconds", (value) => { value.generated_at = "2026-08-20T12:34:56.000Z"; }, /generated_at/],
    ["timestamp offset", (value) => { value.generated_at = "2026-08-20T13:34:56+01:00"; }, /generated_at/],
    ["impossible timestamp", (value) => { value.generated_at = "2026-02-30T12:34:56Z"; }, /timestamp/],
    ["traversal path", (value) => { value.files[0].path = "../README.md"; }, /path|normalized/],
    ["lexical alias", (value) => { value.files[0].path = "./README.md"; }, /path|normalized/],
    ["backslash alias", (value) => { value.files[0].path = "folder\\file"; }, /POSIX/],
    ["duplicate path", (value) => { value.files[1].path = value.files[0].path; }, /duplicate/],
    ["case collision", (value) => { value.files[1].path = value.files[0].path.toLowerCase(); }, /case-colliding/],
    ["nondeterministic order", (value) => { value.files.reverse(); }, /deterministic/],
    ["negative bytes", (value) => { value.files[0].bytes = -1; }, /bytes/],
    ["fractional bytes", (value) => { value.files[0].bytes = 1.5; }, /bytes/],
    ["oversized bytes", (value) => { value.files[0].bytes = MAX_PUBLIC_FILE_BYTES + 1; }, /bytes/],
    ["uppercase hash", (value) => { value.files[0].sha256 = "A".repeat(64); }, /SHA-256/],
    ["short hash", (value) => { value.files[0].sha256 = "a".repeat(63); }, /SHA-256/],
    ["extra manifest key", (value) => { value.note = "unexpected"; }, /keys/]
  ];

  for (const [label, mutate, pattern] of mutations) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.throws(
      () => validateManifestStructure(candidate, { expectedVersion: "1.0.3", expectedPaths }),
      pattern,
      label
    );
  }

  assert.throws(
    () => validateManifestStructure(manifestFor("1.0.3"), { expectedVersion: "1.0.3", expectedPaths }),
    /required source list/,
    "missing required files were accepted"
  );
});

test("generated_at accepts only canonical explicit or reproducible whole-second UTC input", () => {
  assert.equal(resolveGeneratedAt({ generatedAt: "2026-08-20T12:34:56Z" }), "2026-08-20T12:34:56Z");
  assert.equal(resolveGeneratedAt({ sourceDateEpoch: "0" }), "1970-01-01T00:00:00Z");
  assert.equal(
    resolveGeneratedAt({ now: () => new Date("2026-08-20T12:34:56.987Z") }),
    "2026-08-20T12:34:56Z"
  );
  for (const sourceDateEpoch of ["", "00", "-1", "1.5", "9007199254740992"]) {
    assert.throws(() => resolveGeneratedAt({ sourceDateEpoch }), /SOURCE_DATE_EPOCH/);
  }
  assert.throws(() => resolveGeneratedAt({ now: () => new Date("invalid") }), /valid Date/);
});

test("canonical provenance rejects a well-formed SHA that does not resolve locally", async () => {
  const { root, path, bytes } = await committedFixture();
  await assert.rejects(
    verifyPinnedSourcesAtCommit({
      root,
      commit: "0".repeat(40),
      files: [artifactFor(path, bytes)]
    }),
    /does not resolve locally to a commit/
  );
});

test("canonical provenance rejects dirty pinned bytes before manifest publication", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "bounder-provenance-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await defaultGitRunner({
    root,
    args: ["init", "--quiet"]
  });
  await defaultGitRunner({ root, args: ["config", "user.name", "Bounder Test"] });
  await defaultGitRunner({ root, args: ["config", "user.email", "bounder-test@example.invalid"] });
  await fs.mkdir(join(root, "release"));
  await fs.writeFile(join(root, "VERSION"), "1.0.3\n");
  await fs.writeFile(join(root, "README.md"), "committed readme\n");
  await writeBaseline(root, "1.0.2");
  await defaultGitRunner({ root, args: ["add", "--", "VERSION", "README.md", "release"] });
  await defaultGitRunner({ root, args: ["commit", "--quiet", "--no-gpg-sign", "-m", "fixture"] });
  const { stdout: headBytes } = await defaultGitRunner({
    root,
    args: ["rev-parse", "--verify", "HEAD"],
    maxBuffer: 64
  });
  const commit = headBytes.toString("utf8").trim();
  await fs.writeFile(join(root, "README.md"), "dirty working-tree readme\n");
  await assert.rejects(
    generateReleaseManifest({
      root,
      canonicalInterlock: { ...canonicalInterlock, commit },
      expectedHistoricalDigests: null,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      logger: quietLogger
    }),
    /Pinned source README\.md differs from canonical_interlock\.commit/
  );
  await assert.rejects(fs.lstat(join(root, "release", "bounder-reference-v1.0.3.manifest.json")), { code: "ENOENT" });
  await assertNoManifestDebris(root);
});

test("canonical provenance accepts exact bytes from a valid local source commit", async () => {
  const { root, commit, path, bytes } = await committedFixture();
  const files = [artifactFor(path, bytes)];
  assert.equal(
    await verifyPinnedSourcesAtCommit({ root, commit, files }),
    files
  );
});

test("canonical provenance rejects a committed symlink even when its blob bytes match", async () => {
  const path = "LICENSE";
  const bytes = Buffer.from("README.md");
  const gitRunner = async ({ args }) => {
    if (args[0] === "cat-file" && args[1] === "-t") {
      return { stdout: Buffer.from("commit\n"), stderr: Buffer.alloc(0) };
    }
    if (args[0] === "ls-tree") {
      assert.deepEqual(args, [
        "ls-tree",
        "-z",
        "--full-tree",
        "1".repeat(40),
        "--",
        ":(literal)LICENSE"
      ]);
      return {
        stdout: Buffer.from(`120000 blob ${"a".repeat(40)}\t${path}\0`),
        stderr: Buffer.alloc(0)
      };
    }
    if (args[0] === "cat-file" && args[1] === "blob") {
      return { stdout: bytes, stderr: Buffer.alloc(0) };
    }
    throw new Error(`Unexpected Git arguments: ${JSON.stringify(args)}`);
  };
  await assert.rejects(
    verifyPinnedSourcesAtCommit({
      root: fileURLToPath(repositoryRoot),
      commit: "1".repeat(40),
      files: [artifactFor(path, bytes)],
      gitRunner
    }),
    /ordinary non-executable Git blob with mode 100644; got 120000 blob/
  );
});

test("canonical provenance rejects malformed Git object metadata and unreadable blobs", async () => {
  const path = "LICENSE";
  const bytes = Buffer.from("x");
  const commit = "1".repeat(40);
  const object = "a".repeat(40);
  const validTree = Buffer.from(`100644 blob ${object}\t${path}\0`);
  const artifact = artifactFor(path, bytes);
  const cases = [
    {
      name: "wrong object type",
      mutate: { type: Buffer.from("blob\n") },
      pattern: /does not resolve locally to a commit/
    },
    {
      name: "missing tree entry",
      mutate: { tree: Buffer.alloc(0) },
      pattern: /exactly one pinned source entry/
    },
    {
      name: "malformed tree entry",
      mutate: { tree: Buffer.from(`100644 blob ${object}\0`) },
      pattern: /malformed tree entry/
    },
    {
      name: "mismatched tree path",
      mutate: { tree: Buffer.from(`100644 blob ${object}\tREADME.md\0`) },
      pattern: /malformed or mismatched tree entry/
    },
    {
      name: "unreadable tree",
      mutate: { treeError: new Error("tree unavailable") },
      pattern: /does not contain readable pinned source/
    },
    {
      name: "unreadable blob",
      mutate: { blobError: new Error("blob unavailable") },
      pattern: /does not contain readable pinned source/
    },
    {
      name: "oversized blob",
      mutate: { blob: Buffer.from("xx") },
      pattern: /Committed pinned source exceeds the 1-byte limit/
    }
  ];

  for (const { name, mutate, pattern } of cases) {
    const gitRunner = async ({ args }) => {
      if (args[0] === "cat-file" && args[1] === "-t") {
        return { stdout: mutate.type ?? Buffer.from("commit\n"), stderr: Buffer.alloc(0) };
      }
      if (args[0] === "ls-tree") {
        if (mutate.treeError) throw mutate.treeError;
        return { stdout: mutate.tree ?? validTree, stderr: Buffer.alloc(0) };
      }
      if (args[0] === "cat-file" && args[1] === "blob") {
        if (mutate.blobError) throw mutate.blobError;
        return { stdout: mutate.blob ?? bytes, stderr: Buffer.alloc(0) };
      }
      throw new Error(`Unexpected Git arguments: ${JSON.stringify(args)}`);
    };
    await assert.rejects(
      verifyPinnedSourcesAtCommit({
        root: fileURLToPath(repositoryRoot),
        commit,
        files: [artifact],
        gitRunner,
        maxFileBytes: 1
      }),
      pattern,
      name
    );
  }
});

test("the fixed Git runner rejects invalid configuration and retains subprocess diagnostics", async () => {
  const root = fileURLToPath(repositoryRoot);
  assert.throws(() => defaultGitRunner({ root, args: "status" }), /array of strings/);
  assert.throws(() => defaultGitRunner({ root, args: [1] }), /array of strings/);
  assert.throws(() => defaultGitRunner({ root, args: [], maxBuffer: 0 }), /positive safe integer/);
  assert.throws(() => defaultGitRunner({ root, args: [], execFileApi: null }), /must be a function/);
  assert.throws(() => defaultGitRunner({ root, args: [], gitExecutable: "git" }), /absolute trusted path/);
  assert.throws(() => defaultGitExecutable("win32"), /No trusted default Git executable/);

  const processError = new Error("git failed");
  await assert.rejects(
    defaultGitRunner({
      root,
      args: ["status"],
      maxBuffer: 64,
      execFileApi(_file, _args, _options, callback) {
        callback(processError, Buffer.from("captured stdout"), Buffer.from("captured stderr"));
      }
    }),
    (error) => {
      assert.equal(error, processError);
      assert.equal(error.stdout.toString("utf8"), "captured stdout");
      assert.equal(error.stderr.toString("utf8"), "captured stderr");
      return true;
    }
  );
});

test("default Git execution uses an absolute trusted binary, fixed arguments, and isolated environment", async () => {
  let invocation;
  const execFileApi = (file, args, options, callback) => {
    invocation = { file, args, options };
    callback(null, Buffer.from("commit\n"), Buffer.alloc(0));
  };
  const root = fileURLToPath(repositoryRoot);
  await defaultGitRunner({
    root,
    args: ["cat-file", "-t", "1".repeat(40)],
    maxBuffer: 64,
    execFileApi
  });
  assert.equal(invocation.file, "/usr/bin/git");
  assert.deepEqual(invocation.args, [
    "--no-optional-locks",
    "-C",
    resolve(root),
    "cat-file",
    "-t",
    "1".repeat(40)
  ]);
  assert.equal(invocation.options.env.GIT_NO_REPLACE_OBJECTS, "1");
  assert.equal(invocation.options.env.GIT_NO_LAZY_FETCH, "1");
  assert.equal(invocation.options.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(invocation.options.env.PATH, "/usr/bin:/bin");
});

test("receipt drift installs exact dependencies and derives every pinned evidence and schema artifact", async () => {
  const expected = [
    "data/bounder-fleet-evidence.v1.json",
    "data/bounder-receipts.v1.json",
    "data/bounder-staging-pilot.v1.json",
    "data/creedspace-bounder-golden-v1.json",
    "data/creedspace-bounder-roundtrip-v1.json",
    "schemas/bounder-resilience-evidence.v1.schema.json",
    "schemas/bounder.receipt-bundle.v1.schema.json",
    "schemas/bounder.receipt.v1.schema.json",
    "schemas/creedspace-bounder-checkpoint-v1.schema.json",
    "schemas/creedspace-bounder-envelope-v1.schema.json",
    "schemas/creedspace-bounder-policy-v1.schema.json",
    "schemas/creedspace-bounder-profile-v1.schema.json",
    "schemas/creedspace-bounder-roundtrip-v1.schema.json"
  ];
  const manifest = manifestFor("1.0.3", { paths: canonicalPinnedSourcePaths });
  assert.deepEqual(pinnedEvidenceAndSchemaPaths(manifest), expected);
  assert.throws(
    () => pinnedEvidenceAndSchemaPaths(manifestFor("1.0.3", { paths: ["README.md"] })),
    /pins no evidence or schema artifacts/
  );

  const workflow = await fs.readFile(new URL("../.github/workflows/receipt-drift.yml", import.meta.url), "utf8");
  const install = workflow.indexOf("npm ci --ignore-scripts");
  const testSuite = workflow.indexOf("node --test tests/producer-derivation.test.js tests/release-manifest-v2.test.js");
  assert.ok(install >= 0 && testSuite > install, "receipt drift does not install lockfile dependencies before testing");
  assert.match(workflow, /ref: b703add7693061381e4001a15b7d7768406122c4/);
  assert.match(workflow, /npm run verify:producer -- --producer-root \.\.\/producer/);
  assert.match(workflow, /Producer derivation is unverified in this run/);
  assert.doesNotMatch(workflow, /cmp "\$path" "\$tmp\/\$path"/);
});

test("baseline selection validates every historical manifest and rejects future or malformed poison", async (t) => {
  const root = await makeFixture({ baselines: [] });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeBaseline(root, "1.0.0", { interlock: { ...canonicalInterlock, commit: "0".repeat(40) } });
  await fs.writeFile(join(root, "release", "bounder-reference-v1.0.1.manifest.json"), "{not json\n");
  await writeBaseline(root, "1.0.2", { interlock: { ...canonicalInterlock, commit: "2".repeat(40) } });
  await writeBaseline(root, "9.0.0", { interlock: { ...canonicalInterlock, commit: "9".repeat(40) } });

  await assert.rejects(selectFixtureBaseline({ root, version: "1.0.3" }), /not strictly lower/);
  await fs.rm(join(root, "release", "bounder-reference-v9.0.0.manifest.json"));
  await assert.rejects(
    selectFixtureBaseline({ root, version: "1.0.3" }),
    /not valid JSON/,
    "corrupt non-highest history was silently ignored"
  );
  await writeBaseline(root, "1.0.1", { interlock: { ...canonicalInterlock, commit: "1".repeat(40) } });
  const selected = await selectFixtureBaseline({ root, version: "1.0.3" });
  assert.equal(selected.version, "1.0.2");
  assert.equal(selected.manifest.canonical_interlock.commit, "2".repeat(40));
  assert.deepEqual(selected.history.map(({ version }) => version), ["1.0.2", "1.0.1", "1.0.0"]);

  await fs.writeFile(join(root, "release", "bounder-reference-v1.0.2.manifest.json"), "{not json\n");
  await assert.rejects(
    selectFixtureBaseline({ root, version: "1.0.3" }),
    /not valid JSON/,
    "corrupt highest lower history silently fell back to an older release"
  );

  await fs.writeFile(join(root, "release", "bounder-reference-v01.0.2.manifest.json"), "{}\n");
  await assert.rejects(selectFixtureBaseline({ root, version: "1.0.3" }), /Malformed release manifest filename/);
});

test("baseline selection rejects wrong historical inventories, duplicate members, and escaped member aliases", async (t) => {
  const wrongInventory = await makeFixture({ baselines: [] });
  t.after(() => fs.rm(wrongInventory, { recursive: true, force: true }));
  await writeBaseline(wrongInventory, "1.0.2", { paths: ["README.md"] });
  await assert.rejects(
    selectFixtureBaseline({ root: wrongInventory, version: "1.0.3" }),
    /required source list/,
    "an incomplete historical inventory was accepted"
  );

  const duplicateMember = await makeFixture({ baselines: [] });
  t.after(() => fs.rm(duplicateMember, { recursive: true, force: true }));
  const validText = `${JSON.stringify(manifestFor("1.0.2", {
    paths: expectedPinnedPathsForVersion("1.0.2")
  }), null, 2)}\n`;
  await fs.writeFile(
    join(duplicateMember, "release", "bounder-reference-v1.0.2.manifest.json"),
    validText.replace('"version": "1.0.2",', '"version": "1.0.2",\n  "version": "1.0.2",')
  );
  await assert.rejects(
    selectFixtureBaseline({ root: duplicateMember, version: "1.0.3" }),
    /duplicate object member: version/,
    "a duplicate JSON member was silently resolved by JSON.parse"
  );

  const escapedAlias = await makeFixture({ baselines: [] });
  t.after(() => fs.rm(escapedAlias, { recursive: true, force: true }));
  await fs.writeFile(
    join(escapedAlias, "release", "bounder-reference-v1.0.2.manifest.json"),
    validText.replace('"version":', '"vers\\u0069on":')
  );
  await assert.rejects(
    selectFixtureBaseline({ root: escapedAlias, version: "1.0.3" }),
    /escaped or non-canonical object member name/,
    "an escaped object-member alias was accepted as canonical"
  );
});

test("historical release manifests remain pinned byte-for-byte", async (t) => {
  const root = fileURLToPath(repositoryRoot);
  const fixture = await fs.mkdtemp(join(tmpdir(), "bounder-history-digest-test-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.mkdir(join(fixture, "release"));
  for (const version of Object.keys(historicalManifestSha256)) {
    const name = `bounder-reference-v${version}.manifest.json`;
    await fs.copyFile(join(root, "release", name), join(fixture, "release", name));
  }

  const selected = await selectBaseline({ root: fixture, version: "1.0.4" });
  assert.deepEqual(
    selected.history.map(({ version }) => version),
    Object.keys(historicalManifestSha256).sort().reverse()
  );

  const historical = join(fixture, "release", "bounder-reference-v1.0.0.manifest.json");
  const parsed = JSON.parse(await fs.readFile(historical, "utf8"));
  parsed.generated_at = "2026-07-17T00:23:30Z";
  await writeJson(historical, parsed);
  await assert.rejects(
    selectBaseline({ root: fixture, version: "1.0.4" }),
    /differs from its immutable digest/
  );
});

test("generation is deterministic, requires explicit current provenance, and publishes exclusively", async (t) => {
  const root = await makeFixture({ baselines: [] });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeBaseline(root, "1.0.1", { interlock: { ...canonicalInterlock, commit: "1".repeat(40) } });
  await writeBaseline(root, "1.0.2", { interlock: { ...canonicalInterlock, commit: "2".repeat(40) } });
  let stagedManifest;
  const observingFs = {
    ...defaultFileSystem,
    async writeFile(path, data, options) {
      if (String(path).includes(".bounder-manifest-stage-")) stagedManifest = String(path);
      return defaultFileSystem.writeFile(path, data, options);
    }
  };

  const { manifest, target } = await generateManifest({
    root,
    requiredPaths: ["simulator-contracts.js", "README.md"],
    generatedAt: "2026-08-20T12:34:56Z",
    fsApi: observingFs,
    logger: quietLogger
  });
  assert.equal(dirname(dirname(stagedManifest)), root, "manifest staging entered an allowlisted subdirectory");
  assert.equal(manifest.canonical_interlock.commit, canonicalInterlock.commit);
  assert.deepEqual(manifest.files.map(({ path }) => path), ["README.md", "simulator-contracts.js"]);
  assert.equal(manifest.files[0].bytes, Buffer.byteLength("fixture readme\n"));
  assert.equal(manifest.files[0].sha256, hash("fixture readme\n"));
  assert.equal(manifest.generated_at, "2026-08-20T12:34:56Z");
  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), manifest);
  await assertNoManifestDebris(root);

  await assert.rejects(
    generateManifest({ root, requiredPaths: ["README.md"], generatedAt: "2026-08-20T12:34:56Z", logger: quietLogger }),
    /target already exists/
  );
  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), manifest, "existing target was modified");
});

test("generation rejects a timestamp rollback behind any historical release", async (t) => {
  const root = await makeFixture({ baselines: ["1.0.1", "1.0.2"] });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeBaseline(root, "1.0.1", { generatedAt: "2026-08-20T12:34:57Z" });
  await writeBaseline(root, "1.0.2", { generatedAt: "2026-08-20T12:34:56Z" });

  await assert.rejects(
    generateManifest({
      root,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      logger: quietLogger
    }),
    /may not precede historical release timestamp 2026-08-20T12:34:57Z/
  );
  await assert.rejects(
    fs.lstat(join(root, "release", "bounder-reference-v1.0.3.manifest.json")),
    { code: "ENOENT" }
  );
});

test("manifest generation and its CLI never inherit a prior release commit implicitly", async (t) => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    generateReleaseManifest({
      root,
      expectedHistoricalDigests: null,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      logger: quietLogger
    }),
    /canonical_interlock must be supplied explicitly/
  );

  let called = false;
  const missingProcess = { exitCode: 0 };
  assert.equal(await runReleaseManifestCli({
    generate: async () => { called = true; },
    env: {},
    processApi: missingProcess,
    logger: { error() {} }
  }), 1);
  assert.equal(called, false);
  assert.equal(missingProcess.exitCode, 1);

  let received;
  assert.equal(await runReleaseManifestCli({
    generate: async (options) => { received = options.canonicalInterlock; },
    env: { BOUNDER_CANONICAL_COMMIT: "3".repeat(40) },
    processApi: { exitCode: 0 },
    logger: quietLogger
  }), 0);
  assert.deepEqual(received, {
    repository: CANONICAL_INTERLOCK_REPOSITORY,
    ref: CANONICAL_INTERLOCK_REF,
    commit: "3".repeat(40)
  });
});

test("traversal, aliases, missing sources, duplicates, and source symlinks never create a target", async (t) => {
  const cases = [
    [["../outside.txt"], /normalized|unsafe|escapes/],
    [["./README.md"], /normalized/],
    [["README.md", "README.md"], /duplicate/],
    [["README.md", "readme.md"], /case-colliding/],
    [["missing.txt"], /ENOENT|no such file/i]
  ];

  for (const [requiredPaths, pattern] of cases) {
    const root = await makeFixture();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await assert.rejects(
      generateManifest({ root, requiredPaths, generatedAt: "2026-08-20T12:34:56Z", logger: quietLogger }),
      pattern
    );
    await assert.rejects(fs.lstat(join(root, "release", "bounder-reference-v1.0.3.manifest.json")), { code: "ENOENT" });
    await assertNoManifestDebris(root);
  }

  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.symlink(join(root, "README.md"), join(root, "alias.md"));
  await assert.rejects(
    generateManifest({ root, requiredPaths: ["alias.md"], generatedAt: "2026-08-20T12:34:56Z", logger: quietLogger }),
    /symlink/
  );
  await assert.rejects(fs.lstat(join(root, "release", "bounder-reference-v1.0.3.manifest.json")), { code: "ENOENT" });
  await assertNoManifestDebris(root);

  const hardlinked = await makeFixture();
  t.after(() => fs.rm(hardlinked, { recursive: true, force: true }));
  const excluded = join(dirname(hardlinked), "excluded-manifest-source.txt");
  await fs.writeFile(excluded, "excluded bytes\n");
  await fs.link(excluded, join(hardlinked, "hardlink.md"));
  await assert.rejects(
    generateManifest({
      root: hardlinked,
      requiredPaths: ["hardlink.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      logger: quietLogger
    }),
    /hard link/
  );
  await assert.rejects(fs.lstat(join(hardlinked, "release", "bounder-reference-v1.0.3.manifest.json")), { code: "ENOENT" });
  await assertNoManifestDebris(hardlinked);
});

test("concurrent generators produce one complete winner and one clean exclusive failure", async (t) => {
  const root = await makeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = {
    root,
    canonicalInterlock,
    gitRunner: fixtureGitRunner,
    expectedHistoricalDigests: null,
    requiredPaths: ["README.md", "simulator-contracts.js"],
    generatedAt: "2026-08-20T12:34:56Z",
    logger: quietLogger
  };
  const results = await Promise.allSettled([
    generateReleaseManifest(options),
    generateReleaseManifest(options)
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.match(results.find(({ status }) => status === "rejected").reason.message, /target already exists/);

  const target = join(root, "release", "bounder-reference-v1.0.3.manifest.json");
  const manifest = JSON.parse(await fs.readFile(target, "utf8"));
  validateManifestStructure(manifest, {
    expectedVersion: "1.0.3",
    expectedPaths: ["README.md", "simulator-contracts.js"]
  });
  await assertNoManifestDebris(root);
});

test("partial staging and publication failures roll back without target or temporary debris", async (t) => {
  const partialWrite = await makeFixture();
  t.after(() => fs.rm(partialWrite, { recursive: true, force: true }));
  const partialWriteFs = {
    ...defaultFileSystem,
    async writeFile(path, data, options) {
      if (String(path).includes(".bounder-manifest-stage-")) {
        await defaultFileSystem.writeFile(path, String(data).slice(0, 11), options);
        const error = new Error("injected partial write failure");
        error.code = "EIO";
        throw error;
      }
      return defaultFileSystem.writeFile(path, data, options);
    }
  };
  await assert.rejects(
    generateManifest({
      root: partialWrite,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      fsApi: partialWriteFs,
      logger: quietLogger
    }),
    /injected partial write failure/
  );
  await assert.rejects(fs.lstat(join(partialWrite, "release", "bounder-reference-v1.0.3.manifest.json")), { code: "ENOENT" });
  await assertNoManifestDebris(partialWrite);

  const failedLink = await makeFixture();
  t.after(() => fs.rm(failedLink, { recursive: true, force: true }));
  const failedLinkFs = {
    ...defaultFileSystem,
    async link() {
      const error = new Error("injected exclusive-link failure");
      error.code = "EIO";
      throw error;
    }
  };
  await assert.rejects(
    generateManifest({
      root: failedLink,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      fsApi: failedLinkFs,
      logger: quietLogger
    }),
    /exclusive-link failure/
  );
  await assert.rejects(fs.lstat(join(failedLink, "release", "bounder-reference-v1.0.3.manifest.json")), { code: "ENOENT" });
  await assertNoManifestDebris(failedLink);

  const postSuccessLink = await makeFixture();
  t.after(() => fs.rm(postSuccessLink, { recursive: true, force: true }));
  const postSuccessLinkFs = {
    ...defaultFileSystem,
    async link(source, target) {
      await defaultFileSystem.link(source, target);
      const error = new Error("injected post-success link exception");
      error.code = "EIO";
      throw error;
    }
  };
  await assert.rejects(
    generateManifest({
      root: postSuccessLink,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      fsApi: postSuccessLinkFs,
      logger: quietLogger
    }),
    /post-success link exception/
  );
  await assert.rejects(
    fs.lstat(join(postSuccessLink, "release", "bounder-reference-v1.0.3.manifest.json")),
    { code: "ENOENT" },
    "a post-success link exception left a published target behind"
  );
  await assertNoManifestDebris(postSuccessLink);

  const failedCleanup = await makeFixture();
  t.after(() => fs.rm(failedCleanup, { recursive: true, force: true }));
  let injectedCleanupFailure = false;
  const failedCleanupFs = {
    ...defaultFileSystem,
    async rmdir(path, ...args) {
      if (!injectedCleanupFailure && String(path).includes(".bounder-manifest-stage-")) {
        injectedCleanupFailure = true;
        const error = new Error("injected manifest cleanup failure");
        error.code = "EACCES";
        throw error;
      }
      return defaultFileSystem.rmdir(path, ...args);
    }
  };
  await assert.rejects(
    generateManifest({
      root: failedCleanup,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      fsApi: failedCleanupFs,
      logger: quietLogger
    }),
    /injected manifest cleanup failure/
  );
  assert.equal(injectedCleanupFailure, true);
  await assert.rejects(
    fs.lstat(join(failedCleanup, "release", "bounder-reference-v1.0.3.manifest.json")),
    { code: "ENOENT" },
    "cleanup failure reported success with a hardlinked target"
  );
  await assertNoManifestDebris(failedCleanup);

  const lateCorruption = await makeFixture();
  t.after(() => fs.rm(lateCorruption, { recursive: true, force: true }));
  const lateTarget = join(lateCorruption, "release", "bounder-reference-v1.0.3.manifest.json");
  let injectedLateCorruption = false;
  const lateCorruptionFs = {
    ...defaultFileSystem,
    async readFile(path, ...args) {
      const value = await defaultFileSystem.readFile(path, ...args);
      if (!injectedLateCorruption && path === join(lateCorruption, "VERSION")) {
        try {
          await defaultFileSystem.lstat(lateTarget);
          await defaultFileSystem.writeFile(lateTarget, "CORRUPT\n");
          injectedLateCorruption = true;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      return value;
    }
  };
  await assert.rejects(
    generateManifest({
      root: lateCorruption,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      fsApi: lateCorruptionFs,
      logger: quietLogger
    }),
    /final byte-for-byte verification/
  );
  assert.equal(injectedLateCorruption, true, "the late target-corruption race was not exercised");
  await assert.rejects(fs.lstat(lateTarget), { code: "ENOENT" });
  await assertNoManifestDebris(lateCorruption);

  const ownershipLoss = await makeFixture();
  t.after(() => fs.rm(ownershipLoss, { recursive: true, force: true }));
  const foreignTarget = join(ownershipLoss, "release", "bounder-reference-v1.0.3.manifest.json");
  let injectedOwnershipLoss = false;
  const ownershipLossFs = {
    ...defaultFileSystem,
    async readFile(path, ...args) {
      const value = await defaultFileSystem.readFile(path, ...args);
      if (!injectedOwnershipLoss && path === join(ownershipLoss, "VERSION")) {
        try {
          await defaultFileSystem.lstat(foreignTarget);
          await defaultFileSystem.unlink(foreignTarget);
          await defaultFileSystem.writeFile(foreignTarget, "CONCURRENT OWNER\n");
          injectedOwnershipLoss = true;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      return value;
    }
  };
  await assert.rejects(
    generateManifest({
      root: ownershipLoss,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      fsApi: ownershipLossFs,
      logger: quietLogger
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.errors.some((entry) => /target ownership was lost/.test(entry.message)), true);
      return true;
    }
  );
  assert.equal(injectedOwnershipLoss, true, "the concurrent target replacement was not exercised");
  assert.equal(await fs.readFile(foreignTarget, "utf8"), "CONCURRENT OWNER\n");
  await assertNoManifestDebris(ownershipLoss);

  const changedVersion = await makeFixture();
  t.after(() => fs.rm(changedVersion, { recursive: true, force: true }));
  const changedVersionFs = {
    ...defaultFileSystem,
    async link(source, target) {
      await defaultFileSystem.link(source, target);
      await defaultFileSystem.writeFile(join(changedVersion, "VERSION"), "9.9.9\n");
    }
  };
  await assert.rejects(
    generateManifest({
      root: changedVersion,
      requiredPaths: ["README.md"],
      generatedAt: "2026-08-20T12:34:56Z",
      fsApi: changedVersionFs,
      logger: quietLogger
    }),
    /VERSION changed during release manifest publication/
  );
  await assert.rejects(fs.lstat(join(changedVersion, "release", "bounder-reference-v1.0.3.manifest.json")), { code: "ENOENT" });
  await assertNoManifestDebris(changedVersion);
});

test("the current release line has either a sealed v2 manifest or an explicit source-candidate transition", async () => {
  const versionText = await fs.readFile(new URL("VERSION", repositoryRoot), "utf8");
  const version = versionText.endsWith("\n") ? versionText.slice(0, -1) : versionText;
  assert.equal(versionText, `${version}\n`, "VERSION is not canonical");
  parseStrictSemVer(version);
  const root = fileURLToPath(repositoryRoot);
  const target = join(root, "release", `bounder-reference-v${version}.manifest.json`);
  let source;
  try {
    source = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    assert.equal(version, "1.1.0");
    await Promise.all([
      fs.access(join(root, "scripts", "generate-release-manifest-v2.mjs")),
      fs.access(join(root, "schemas", "bounder-release-manifest-v2.schema.json"))
    ]);
    return;
  }
  const manifest = JSON.parse(source);
  assert.equal(manifest.manifest_version, "bounder-release-manifest/v2");
  const { validateManifest } = await import("../scripts/generate-release-manifest-v2.mjs");
  await validateManifest(root, manifest);
  for (const file of manifest.files) {
    const bytes = await fs.readFile(join(root, file.path));
    assert.equal(bytes.byteLength, file.bytes, file.path);
    assert.equal(hash(bytes), file.sha256, file.path);
  }
});
