import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_PUBLIC_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PUBLIC_ENTRIES = 10_000;
export const MAX_PUBLIC_TOTAL_BYTES = 512 * 1024 * 1024;

export const canonicalPublicPaths = Object.freeze([
  "404.html", "CNAME", "CHANGELOG.md", "LICENSE", "NOTICE", "README.md",
  "SECURITY.md", "VERSION", "contact.html", "continuity-evidence.js",
  "favicon.ico", "index.html", "policy-roundtrip.js", "privacy.html",
  "robots.txt", "simulator-bootstrap.js", "simulator-contracts.js",
  "simulator-fallback.js", "simulator-world.js", "simulator.css",
  "simulator.html", "simulator.js", "site.js", "sitemap.xml",
  "staging-feed.js", "styles.css", "terms.html", "assets", "data",
  "guides", "images", "release", "schemas", "vendor"
]);

export const defaultFileSystem = Object.freeze({ ...nodeFs });

const modulePath = fileURLToPath(import.meta.url);
export const canonicalRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validateSafeRelativePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (Buffer.byteLength(value, "utf8") > 4096) throw new Error(`${label} exceeds the 4096-byte portable path limit`);
  if (value.includes("\0")) throw new Error(`${label} contains a NUL byte: ${JSON.stringify(value)}`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label} contains a control character: ${JSON.stringify(value)}`);
  if (value.includes("\\")) throw new Error(`${label} must use POSIX separators: ${value}`);
  if (isAbsolute(value) || value.startsWith("/")) throw new Error(`${label} must be relative: ${value}`);
  if (value !== value.normalize("NFC")) throw new Error(`${label} must use NFC Unicode: ${value}`);
  if (posix.normalize(value) !== value) throw new Error(`${label} is not normalized: ${value}`);
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} contains an unsafe segment: ${value}`);
  }
  if (segments.some((segment) => Buffer.byteLength(segment, "utf8") > 255)) {
    throw new Error(`${label} contains a segment longer than 255 bytes: ${value}`);
  }
  return value;
}

export function portableCollisionKey(value) {
  return validateSafeRelativePath(value).normalize("NFKC").toLowerCase();
}

export function resolveContainedPath(root, relativePath, label = "path") {
  const safePath = validateSafeRelativePath(relativePath, label);
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, ...safePath.split("/"));
  const fromRoot = relative(absoluteRoot, absolutePath);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes the root: ${relativePath}`);
  }
  return absolutePath;
}

function isSameOrDescendant(parent, candidate) {
  const fromParent = relative(resolve(parent), resolve(candidate));
  return fromParent === "" || (fromParent !== ".." && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent));
}

async function assertRealRoot(root, fsApi, label = "tree root") {
  const info = await fsApi.lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory: ${root}`);
}

export async function lstatContainedPath(root, relativePath, fsApi = defaultFileSystem, label = "path") {
  const safePath = validateSafeRelativePath(relativePath, label);
  const absoluteRoot = resolve(root);
  await assertRealRoot(absoluteRoot, fsApi);
  let current = absoluteRoot;
  let info;
  const segments = safePath.split("/");

  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    info = await fsApi.lstat(current);
    if (info.isSymbolicLink()) throw new Error(`${label} may not traverse a symlink: ${safePath}`);
    if (index < segments.length - 1 && !info.isDirectory()) {
      throw new Error(`${label} has a non-directory ancestor: ${segments.slice(0, index + 1).join("/")}`);
    }
  }

  return { absolutePath: current, info };
}

async function lstatOrNull(path, fsApi) {
  try {
    return await fsApi.lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function renameToAbsentTarget({ source, target, expectedSourceIdentity, fsApi, label, warnings }) {
  const sourceBefore = await fsApi.lstat(source);
  if (expectedSourceIdentity && !isSameNodeIdentity(expectedSourceIdentity, sourceBefore)) {
    throw new Error(`${label} source ownership was lost before rename`);
  }
  if (await lstatOrNull(target, fsApi)) {
    const error = new Error(`${label} target already exists: ${target}`);
    error.code = "EEXIST";
    throw error;
  }

  try {
    await fsApi.rename(source, target);
    const targetAfter = await fsApi.lstat(target);
    if (!isSameNodeIdentity(sourceBefore, targetAfter)) {
      throw new Error(`${label} target ownership was lost after rename`);
    }
  } catch (error) {
    let sourceAfter;
    let targetAfter;
    try {
      [sourceAfter, targetAfter] = await Promise.all([
        lstatOrNull(source, fsApi),
        lstatOrNull(target, fsApi)
      ]);
    } catch (inspectionError) {
      throw new AggregateError(
        [error, inspectionError],
        `${label} failed and its filesystem postcondition could not be inspected`
      );
    }
    if (
      !sourceAfter
      && targetAfter
      && sourceBefore.dev === targetAfter.dev
      && sourceBefore.ino === targetAfter.ino
    ) {
      warnings.push(new Error(`${label} completed although the filesystem adapter reported failure`, { cause: error }));
      return sourceBefore;
    }
    throw error;
  }
  return sourceBefore;
}

function isSameNodeIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
}

async function quarantineOwnedTree({ path, expectedIdentity, fsApi, label, warnings }) {
  const recoveryRoot = await fsApi.mkdtemp(join(dirname(path), `.${basename(path)}.failed-`));
  const recovery = join(recoveryRoot, "artifact");
  try {
    await renameToAbsentTarget({
      source: path,
      target: recovery,
      expectedSourceIdentity: expectedIdentity,
      fsApi,
      label,
      warnings
    });
    return { recoveryRoot, recovery };
  } catch (error) {
    let sourceAfter;
    let recoveryAfter;
    try {
      [sourceAfter, recoveryAfter] = await Promise.all([
        lstatOrNull(path, fsApi),
        lstatOrNull(recovery, fsApi)
      ]);
    } catch (inspectionError) {
      throw new AggregateError(
        [error, inspectionError],
        `${label} failed and recovery ownership could not be inspected at ${recoveryRoot}`
      );
    }
    if (!sourceAfter && recoveryAfter) {
      return {
        recoveryRoot,
        recovery,
        ownershipLost: !isSameNodeIdentity(expectedIdentity, recoveryAfter)
      };
    }
    try {
      await fsApi.rmdir(recoveryRoot);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `${label} failed; recovery data was preserved at ${recoveryRoot}`);
    }
    throw error;
  }
}

function registerEntry(entry, registry, entries, limits) {
  const key = portableCollisionKey(entry.path);
  const existing = registry.get(key);
  if (existing) {
    throw new Error(`Duplicate or case-colliding public paths: ${existing} and ${entry.path}`);
  }
  if (entries.length >= limits.maxEntries) {
    throw new Error(`Public tree exceeds the ${limits.maxEntries}-entry limit`);
  }
  if (entry.type === "file") {
    const nextTotal = limits.totalBytes + entry.bytes;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > limits.maxTotalBytes) {
      throw new Error(`Public tree exceeds the ${limits.maxTotalBytes}-byte aggregate limit`);
    }
    limits.totalBytes = nextTotal;
  }
  registry.set(key, entry.path);
  entries.push(entry);
}

async function inspectEntry({ absoluteRoot, relativePath, fsApi, maxFileBytes, registry, entries, limits }) {
  const { absolutePath, info } = await lstatContainedPath(absoluteRoot, relativePath, fsApi, "public path");

  if (info.isSymbolicLink()) throw new Error(`Public path may not be a symlink: ${relativePath}`);

  if (info.isDirectory()) {
    registerEntry({ path: relativePath, type: "directory" }, registry, entries, limits);
    const names = (await fsApi.readdir(absolutePath)).sort(comparePaths);
    if (entries.length + names.length > limits.maxEntries) {
      throw new Error(`Public tree exceeds the ${limits.maxEntries}-entry limit`);
    }
    for (const name of names) {
      validateSafeRelativePath(name, `entry under ${relativePath}`);
      await inspectEntry({
        absoluteRoot,
        relativePath: `${relativePath}/${name}`,
        fsApi,
        maxFileBytes,
        registry,
        entries,
        limits
      });
    }
    return;
  }

  if (!info.isFile()) throw new Error(`Public path must be a regular file or directory: ${relativePath}`);
  if (!Number.isSafeInteger(info.nlink) || info.nlink !== 1) {
    throw new Error(`Public file may not be a hard link: ${relativePath}`);
  }
  if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > maxFileBytes) {
    throw new Error(`Public file exceeds the ${maxFileBytes}-byte limit: ${relativePath} (${info.size} bytes)`);
  }

  const bytes = await fsApi.readFile(absolutePath);
  if (bytes.length !== info.size) throw new Error(`Public file changed while being inspected: ${relativePath}`);
  registerEntry({ path: relativePath, type: "file", bytes: bytes.length, sha256: sha256(bytes) }, registry, entries, limits);
}

export async function inspectPublicTree({
  root = canonicalRoot,
  publicPaths = canonicalPublicPaths,
  fsApi = defaultFileSystem,
  maxFileBytes = MAX_PUBLIC_FILE_BYTES,
  maxEntries = MAX_PUBLIC_ENTRIES,
  maxTotalBytes = MAX_PUBLIC_TOTAL_BYTES
} = {}) {
  const absoluteRoot = resolve(root);
  if (!Array.isArray(publicPaths) || publicPaths.length === 0) throw new Error("publicPaths must be a non-empty array");
  for (const [value, label] of [
    [maxFileBytes, "maxFileBytes"],
    [maxEntries, "maxEntries"],
    [maxTotalBytes, "maxTotalBytes"]
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
  }
  await assertRealRoot(absoluteRoot, fsApi);
  const registry = new Map();
  const entries = [];
  const limits = { maxEntries, maxTotalBytes, totalBytes: 0 };

  for (const relativePath of publicPaths) {
    validateSafeRelativePath(relativePath, "allowlisted public path");
    await inspectEntry({ absoluteRoot, relativePath, fsApi, maxFileBytes, registry, entries, limits });
  }

  return entries.sort((left, right) => comparePaths(left.path, right.path));
}

export async function inspectTree({
  root,
  fsApi = defaultFileSystem,
  maxFileBytes = MAX_PUBLIC_FILE_BYTES,
  maxEntries = MAX_PUBLIC_ENTRIES,
  maxTotalBytes = MAX_PUBLIC_TOTAL_BYTES
}) {
  const absoluteRoot = resolve(root);
  await assertRealRoot(absoluteRoot, fsApi);
  const names = (await fsApi.readdir(absoluteRoot)).sort(comparePaths);
  const registry = new Map();
  const entries = [];
  const limits = { maxEntries, maxTotalBytes, totalBytes: 0 };
  for (const name of names) {
    validateSafeRelativePath(name, "tree entry");
    await inspectEntry({
      absoluteRoot,
      relativePath: name,
      fsApi,
      maxFileBytes,
      registry,
      entries,
      limits
    });
  }
  return entries.sort((left, right) => comparePaths(left.path, right.path));
}

export function assertEquivalentTrees(expected, actual) {
  if (expected.length !== actual.length) {
    throw new Error(`Artifact entry count mismatch: expected ${expected.length}, got ${actual.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      throw new Error(`Artifact differs at ${left?.path ?? index}: expected ${JSON.stringify(left)}, got ${JSON.stringify(right)}`);
    }
  }
}

async function copySnapshot({ root, stage, snapshot, fsApi, maxFileBytes }) {
  for (const entry of snapshot.filter(({ type }) => type === "directory")) {
    await fsApi.mkdir(resolveContainedPath(stage, entry.path, "staged directory"), { recursive: true });
  }

  for (const entry of snapshot.filter(({ type }) => type === "file")) {
    const { absolutePath: source, info: before } = await lstatContainedPath(root, entry.path, fsApi, "source file");
    const target = resolveContainedPath(stage, entry.path, "staged file");
    if (before.isSymbolicLink() || !before.isFile()) throw new Error(`Source stopped being a regular file: ${entry.path}`);
    if (!Number.isSafeInteger(before.nlink) || before.nlink !== 1) throw new Error(`Source became a hard link: ${entry.path}`);
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxFileBytes) {
      throw new Error(`Source file violates the size limit during copy: ${entry.path}`);
    }
    await fsApi.mkdir(dirname(target), { recursive: true });
    await fsApi.copyFile(source, target);
    const copied = await fsApi.lstat(target);
    if (copied.isSymbolicLink() || !copied.isFile()) throw new Error(`Copied output is not a regular file: ${entry.path}`);
    const bytes = await fsApi.readFile(target);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`Source changed while the artifact was being copied: ${entry.path}`);
    }
  }
}

async function verifyPromotedTree({ output, expected, fsApi, maxFileBytes, maxEntries, maxTotalBytes, label }) {
  const actual = await inspectTree({
    root: output,
    fsApi,
    maxFileBytes,
    maxEntries,
    maxTotalBytes
  });
  try {
    assertEquivalentTrees(expected, actual);
  } catch (error) {
    throw new Error(`${label} failed byte-for-byte verification`, { cause: error });
  }
}

async function promoteStage({
  output,
  stage,
  expected,
  fsApi,
  maxFileBytes,
  maxEntries,
  maxTotalBytes,
  warnings
}) {
  const existing = await lstatOrNull(output, fsApi);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new Error(`Existing artifact must be a real directory: ${output}`);
  }

  if (!existing) {
    let promotedIdentity;
    try {
      promotedIdentity = await renameToAbsentTarget({
        source: stage,
        target: output,
        fsApi,
        label: "Artifact promotion",
        warnings
      });
      await verifyPromotedTree({
        output,
        expected,
        fsApi,
        maxFileBytes,
        maxEntries,
        maxTotalBytes,
        label: "Promoted artifact"
      });
    } catch (error) {
      if (promotedIdentity) {
        try {
          const { recovery } = await quarantineOwnedTree({
            path: output,
            expectedIdentity: promotedIdentity,
            fsApi,
            label: "Failed artifact quarantine",
            warnings
          });
          throw new Error(`Artifact verification failed; the failed output was preserved at ${recovery}`, { cause: error });
        } catch (cleanupError) {
          if (cleanupError.cause === error) throw cleanupError;
          throw new AggregateError([error, cleanupError], "Artifact promotion and rollback failed");
        }
      }
      throw error;
    }
    return;
  }

  const previous = await inspectTree({
    root: output,
    fsApi
  });

  const backupRoot = await fsApi.mkdtemp(join(dirname(output), `.${basename(output)}.backup-`));
  const backup = join(backupRoot, "artifact");
  let promotedIdentity;
  let failedRecovery;
  try {
    await renameToAbsentTarget({
      source: output,
      target: backup,
      expectedSourceIdentity: existing,
      fsApi,
      label: "Artifact backup",
      warnings
    });
  } catch (error) {
    try {
      await fsApi.rmdir(backupRoot);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Artifact backup preparation failed for ${output}`);
    }
    throw error;
  }
  try {
    promotedIdentity = await renameToAbsentTarget({
      source: stage,
      target: output,
      fsApi,
      label: "Artifact promotion",
      warnings
    });
    await verifyPromotedTree({
      output,
      expected,
      fsApi,
      maxFileBytes,
      maxEntries,
      maxTotalBytes,
      label: "Promoted artifact"
    });
  } catch (error) {
    const errors = [error];
    let outputCleared = false;
    if (promotedIdentity) {
      try {
        failedRecovery = await quarantineOwnedTree({
          path: output,
          expectedIdentity: promotedIdentity,
          fsApi,
          label: "Failed artifact quarantine",
          warnings
        });
        outputCleared = true;
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    } else {
      try {
        outputCleared = !(await lstatOrNull(output, fsApi));
      } catch (inspectionError) {
        errors.push(new Error("Failed artifact state could not be inspected before restoration", { cause: inspectionError }));
      }
    }
    let backupMoved = false;
    if (outputCleared) {
      try {
        await renameToAbsentTarget({
          source: backup,
          target: output,
          fsApi,
          label: "Artifact restoration",
          warnings
        });
        backupMoved = true;
        await verifyPromotedTree({
          output,
          expected: previous,
          fsApi,
          maxFileBytes: MAX_PUBLIC_FILE_BYTES,
          maxEntries: MAX_PUBLIC_ENTRIES,
          maxTotalBytes: MAX_PUBLIC_TOTAL_BYTES,
          label: "Restored artifact"
        });
      } catch (restoreError) {
        errors.push(restoreError);
      }
    }
    try {
      if (backupMoved && failedRecovery) await fsApi.rmdir(backupRoot);
      else if (backupMoved) await fsApi.rm(backupRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (failedRecovery) {
      throw new AggregateError(
        errors,
        `Artifact promotion failed; the prior artifact was restored and the failed output was preserved at ${failedRecovery.recovery}`
      );
    }
    if (errors.length > 1) throw new AggregateError(errors, `Artifact promotion or restoration failed for ${output}`);
    throw error;
  }
  try {
    await fsApi.rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    warnings.push(new Error(`Published successfully but could not remove backup ${backupRoot}`, { cause: error }));
  }
}

function reportWarning(logger, warning) {
  try {
    logger?.warn?.(warning);
  } catch {
    // A diagnostic sink must never change publication state.
  }
}

export async function buildSite({
  root = canonicalRoot,
  output = resolve(root, "_site"),
  publicPaths = canonicalPublicPaths,
  fsApi = defaultFileSystem,
  maxFileBytes = MAX_PUBLIC_FILE_BYTES,
  maxEntries = MAX_PUBLIC_ENTRIES,
  maxTotalBytes = MAX_PUBLIC_TOTAL_BYTES,
  logger = console
} = {}) {
  const requestedRoot = resolve(root);
  const absoluteOutput = resolve(output);
  await assertRealRoot(requestedRoot, fsApi, "publication root");
  const outputParent = dirname(absoluteOutput);
  const requestedOutputIsInRoot = isSameOrDescendant(requestedRoot, absoluteOutput);
  const requestedParentFromRoot = relative(requestedRoot, outputParent);
  if (
    requestedOutputIsInRoot
    && requestedParentFromRoot !== ""
    && requestedParentFromRoot !== ".."
    && !requestedParentFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(requestedParentFromRoot)
  ) {
    const relativeParent = requestedParentFromRoot.split(sep).join("/");
    const { info } = await lstatContainedPath(
      requestedRoot,
      relativeParent,
      fsApi,
      "publication output ancestor"
    );
    if (!info.isDirectory()) {
      throw new Error(`Publication output parent must be a real existing directory: ${outputParent}`);
    }
  }
  const [absoluteRoot, realOutputParent] = await Promise.all([
    fsApi.realpath(requestedRoot),
    fsApi.realpath(outputParent)
  ]);
  await assertRealRoot(realOutputParent, fsApi, "publication output parent");
  const realOutput = join(realOutputParent, basename(absoluteOutput));
  const realOutputIsInRoot = isSameOrDescendant(absoluteRoot, realOutput);
  if (requestedOutputIsInRoot !== realOutputIsInRoot) {
    throw new Error("Publication output changes repository containment through a symlinked ancestor");
  }
  if (realOutput === absoluteRoot) throw new Error("The publication output may not replace the repository root");
  for (const relativePath of publicPaths) {
    const publicRoot = resolveContainedPath(absoluteRoot, relativePath, "allowlisted public path");
    if (isSameOrDescendant(publicRoot, realOutput) || isSameOrDescendant(realOutput, publicRoot)) {
      throw new Error(`Publication output overlaps allowlisted source path: ${relativePath}`);
    }
  }

  const existingOutput = await lstatOrNull(absoluteOutput, fsApi);
  if (existingOutput && (existingOutput.isSymbolicLink() || !existingOutput.isDirectory())) {
    throw new Error(`Existing artifact must be a real directory: ${absoluteOutput}`);
  }

  const snapshot = await inspectPublicTree({
    root: absoluteRoot,
    publicPaths,
    fsApi,
    maxFileBytes,
    maxEntries,
    maxTotalBytes
  });

  await fsApi.mkdir(dirname(absoluteOutput), { recursive: true });
  const lock = `${absoluteOutput}.lock`;
  let lockHeld = false;
  let stage = null;
  let result;
  let failure;
  const warnings = [];

  try {
    try {
      await fsApi.mkdir(lock);
      lockHeld = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        const locked = new Error(`Another publication build holds the lock: ${lock}`);
        locked.code = "BUILD_LOCKED";
        throw locked;
      }
      throw error;
    }

    stage = await fsApi.mkdtemp(join(dirname(absoluteOutput), `.${basename(absoluteOutput)}.stage-`));
    await copySnapshot({ root: absoluteRoot, stage, snapshot, fsApi, maxFileBytes });
    const stagedSnapshot = await inspectTree({
      root: stage,
      fsApi,
      maxFileBytes,
      maxEntries,
      maxTotalBytes
    });
    assertEquivalentTrees(snapshot, stagedSnapshot);
    const sourceAfterCopy = await inspectPublicTree({
      root: absoluteRoot,
      publicPaths,
      fsApi,
      maxFileBytes,
      maxEntries,
      maxTotalBytes
    });
    try {
      assertEquivalentTrees(snapshot, sourceAfterCopy);
    } catch (error) {
      throw new Error("Public source tree changed while the artifact was being staged", { cause: error });
    }
    await promoteStage({
      output: absoluteOutput,
      stage,
      expected: snapshot,
      fsApi,
      maxFileBytes,
      maxEntries,
      maxTotalBytes,
      warnings
    });
    stage = null;
    result = snapshot;
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors = [];
    if (stage) {
      try {
        await fsApi.rm(stage, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`Could not remove failed publication stage: ${stage}`, { cause: error }));
      }
    }
    if (lockHeld) {
      try {
        await fsApi.rmdir(lock);
      } catch (error) {
        cleanupErrors.push(new Error(`Could not release publication lock: ${lock}`, { cause: error }));
      }
    }

    if (failure && cleanupErrors.length) failure = new AggregateError([failure, ...cleanupErrors], "Publication build and cleanup failed");
    else if (!failure) warnings.push(...cleanupErrors);
  }

  if (failure) throw failure;
  for (const warning of warnings) reportWarning(logger, warning);
  try {
    logger?.log?.(`Built ${result.filter(({ type }) => type === "file").length} files from ${publicPaths.length} allowlisted paths in ${basename(absoluteOutput)}/`);
  } catch {
    // A diagnostic sink must never turn a committed artifact into a failed build.
  }
  return result;
}

export function isMainModule(argvPath = process.argv[1]) {
  if (!argvPath) return false;
  return pathToFileURL(resolve(argvPath)).href === pathToFileURL(modulePath).href;
}

export async function runBuildSiteCli({
  build = buildSite,
  logger = console,
  processApi = process
} = {}) {
  try {
    await build();
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
  await runBuildSiteCli();
}
