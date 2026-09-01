import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  MAX_PUBLIC_FILE_BYTES,
  assertEquivalentTrees,
  buildSite,
  canonicalPublicPaths,
  canonicalRoot,
  defaultFileSystem,
  inspectPublicTree,
  inspectTree,
  runBuildSiteCli,
  validateSafeRelativePath
} from "../scripts/build-site.mjs";

const execFileAsync = promisify(execFile);
const quietLogger = Object.freeze({ log() {}, warn() {} });
const expectedPublicPaths = Object.freeze([
  "404.html", "CNAME", "CHANGELOG.md", "LICENSE", "NOTICE", "README.md",
  "SECURITY.md", "VERSION", "contact.html", "continuity-evidence.js",
  "favicon.ico", "index.html", "policy-roundtrip.js", "privacy.html",
  "robots.txt", "simulator-bootstrap.js", "simulator-contracts.js",
  "simulator-fallback.js", "simulator-world.js", "simulator.css",
  "simulator.html", "simulator.js", "site.js", "sitemap.xml",
  "staging-feed.js", "styles.css", "terms.html", "assets", "data",
  "guides", "images", "release", "runtime", "schemas", "simulator", "ui", "vendor"
]);

async function makeFixture() {
  const base = await fs.mkdtemp(join(tmpdir(), "bounder-publication-test-"));
  const root = join(base, "repository");
  const output = join(base, "site");
  await fs.mkdir(join(root, "public", "nested"), { recursive: true });
  await fs.writeFile(join(root, "public", "file.txt"), "new artifact\n");
  await fs.writeFile(join(root, "public", "nested", "child.txt"), "child\n");
  await fs.mkdir(output);
  await fs.writeFile(join(output, "sentinel.txt"), "prior artifact\n");
  return { base, root, output };
}

async function assertPriorArtifactPreserved({ base, output }) {
  assert.equal(await fs.readFile(join(output, "sentinel.txt"), "utf8"), "prior artifact\n");
  const names = await fs.readdir(base);
  const outputName = basename(output);
  assert.equal(names.some((name) => name === `${outputName}.lock`), false, "publication lock leaked");
  assert.equal(names.some((name) => name.startsWith(`.${outputName}.stage-`)), false, "publication stage leaked");
  assert.equal(names.some((name) => name.startsWith(`.${outputName}.backup-`)), false, "publication backup leaked");
}

async function assertUniqueFilePreserved(root, name, expected) {
  const matches = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name === name) matches.push(path);
    }
  }
  assert.equal(matches.length, 1, `${name} must survive in exactly one recovery location`);
  assert.equal(await fs.readFile(matches[0], "utf8"), expected);
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

test("the exported publication allowlist is exact and explicitly includes every public runtime", async () => {
  assert.equal(Object.isFrozen(canonicalPublicPaths), true);
  assert.deepEqual(canonicalPublicPaths, expectedPublicPaths);
  assert.equal(new Set(canonicalPublicPaths).size, canonicalPublicPaths.length);
  assert.ok(canonicalPublicPaths.includes("simulator-contracts.js"));
  assert.ok(canonicalPublicPaths.includes("runtime"));
  assert.ok(canonicalPublicPaths.includes("simulator"));

  for (const relativePath of canonicalPublicPaths) {
    const info = await fs.lstat(join(canonicalRoot, relativePath));
    assert.equal(info.isSymbolicLink(), false, `${relativePath} is unexpectedly a symlink`);
    assert.equal(info.isFile() || info.isDirectory(), true, `${relativePath} is not publishable`);
  }
});

test("the canonical artifact is a complete recursive byte-for-byte copy of only the allowlist", async (t) => {
  const base = await fs.mkdtemp(join(tmpdir(), "bounder-canonical-artifact-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const output = join(base, "site");

  const built = await buildSite({ output, logger: quietLogger });
  const expected = await inspectPublicTree();
  const actual = await inspectTree({ root: output });
  assertEquivalentTrees(expected, actual);
  assert.deepEqual(built, expected);
  assert.ok(actual.some(({ path, type }) => path === "simulator-contracts.js" && type === "file"));
  assert.ok(actual.some(({ path, type }) => path === "runtime/policy/contracts.js" && type === "file"));
  assert.ok(actual.some(({ path, type }) => path === "simulator/controller.js" && type === "file"));
  assert.ok(actual.length > canonicalPublicPaths.length, "recursive directories were not expanded into their files");

  for (const excluded of [".git", ".github", "docs", "node_modules", "package.json", "scripts", "tests", "tmp"]) {
    await assert.rejects(fs.lstat(join(output, excluded)), { code: "ENOENT" }, `${excluded} leaked into the artifact`);
  }
  const security = await fs.readFile(join(output, "SECURITY.md"), "utf8");
  assert.doesNotMatch(security, /docs\/(?:THREAT_MODEL|LEGACY_STATUS)\.md/);
});

test("unsafe and aliased allowlist paths fail before touching the prior artifact", async (t) => {
  const invalidPaths = [
    "../outside.txt",
    "./public",
    "public//file.txt",
    "/absolute.txt",
    "public\\file.txt",
    "public/line\nbreak.txt",
    `public/${"e\u0301"}.txt`
  ];

  for (const publicPath of invalidPaths) {
    const fixture = await makeFixture();
    t.after(() => fs.rm(fixture.base, { recursive: true, force: true }));
    await assert.rejects(
      buildSite({ ...fixture, publicPaths: [publicPath], logger: quietLogger }),
      /relative|normalized|POSIX|control character|NFC|unsafe|escapes/
    );
    await assertPriorArtifactPreserved(fixture);
  }

  const duplicate = await makeFixture();
  t.after(() => fs.rm(duplicate.base, { recursive: true, force: true }));
  await assert.rejects(
    buildSite({ ...duplicate, publicPaths: ["public", "public/file.txt"], logger: quietLogger }),
    /Duplicate or case-colliding public paths/
  );
  await assertPriorArtifactPreserved(duplicate);

  const caseCollision = await makeFixture();
  t.after(() => fs.rm(caseCollision.base, { recursive: true, force: true }));
  await fs.writeFile(join(caseCollision.root, "public", "Case.txt"), "first");
  await fs.writeFile(join(caseCollision.root, "public", "case.txt"), "second");
  await assert.rejects(
    buildSite({ ...caseCollision, publicPaths: ["public/Case.txt", "public/case.txt"], logger: quietLogger }),
    /Duplicate or case-colliding public paths/
  );
  await assertPriorArtifactPreserved(caseCollision);

  const overlap = await makeFixture();
  t.after(() => fs.rm(overlap.base, { recursive: true, force: true }));
  const nestedOutput = join(overlap.root, "public", "site");
  await fs.mkdir(nestedOutput);
  await fs.writeFile(join(nestedOutput, "sentinel.txt"), "prior artifact\n");
  await assert.rejects(
    buildSite({ root: overlap.root, output: nestedOutput, publicPaths: ["public"], logger: quietLogger }),
    /overlaps allowlisted source path/
  );
  assert.equal(await fs.readFile(join(nestedOutput, "sentinel.txt"), "utf8"), "prior artifact\n");

  const aliasedOutput = await makeFixture();
  t.after(() => fs.rm(aliasedOutput.base, { recursive: true, force: true }));
  const rootAlias = join(aliasedOutput.base, "repository-alias");
  await fs.symlink(aliasedOutput.root, rootAlias, "dir");
  const victimParent = join(aliasedOutput.root, "victims");
  const victim = join(victimParent, "site");
  await fs.mkdir(victim, { recursive: true });
  await fs.writeFile(join(victim, "secret.txt"), "preserve me\n");
  await assert.rejects(
    buildSite({
      root: aliasedOutput.root,
      output: join(rootAlias, "victims", "site"),
      publicPaths: ["public"],
      logger: quietLogger
    }),
    /symlinked ancestor/
  );
  assert.equal(await fs.readFile(join(victim, "secret.txt"), "utf8"), "preserve me\n");

  const internalAlias = await makeFixture();
  t.after(() => fs.rm(internalAlias.base, { recursive: true, force: true }));
  const internalVictimParent = join(internalAlias.root, "internal-victims");
  const internalVictim = join(internalVictimParent, "site");
  await fs.mkdir(internalVictim, { recursive: true });
  await fs.writeFile(join(internalVictim, "secret.txt"), "preserve internal victim\n");
  await fs.symlink(internalVictimParent, join(internalAlias.root, "internal-alias"), "dir");
  await assert.rejects(
    buildSite({
      root: internalAlias.root,
      output: join(internalAlias.root, "internal-alias", "site"),
      publicPaths: ["public"],
      logger: quietLogger
    }),
    /publication output ancestor may not traverse a symlink/
  );
  assert.equal(
    await fs.readFile(join(internalVictim, "secret.txt"), "utf8"),
    "preserve internal victim\n"
  );

  const externalAlias = await makeFixture();
  t.after(() => fs.rm(externalAlias.base, { recursive: true, force: true }));
  const realExternalParent = join(externalAlias.base, "external-output");
  const externalParentAlias = join(externalAlias.base, "external-output-alias");
  const safeOutput = join(externalParentAlias, "nested", "site");
  await fs.mkdir(join(realExternalParent, "nested", "site"), { recursive: true });
  await fs.writeFile(join(realExternalParent, "nested", "site", "sentinel.txt"), "prior artifact\n");
  await fs.symlink(realExternalParent, externalParentAlias, "dir");
  const renameTargets = [];
  const observingFs = {
    ...defaultFileSystem,
    async rename(source, target) {
      renameTargets.push(target);
      return defaultFileSystem.rename(source, target);
    }
  };
  await buildSite({
    root: externalAlias.root,
    output: safeOutput,
    publicPaths: ["public"],
    fsApi: observingFs,
    logger: quietLogger
  });
  assert.equal(await fs.readFile(join(safeOutput, "public", "file.txt"), "utf8"), "new artifact\n");
  assert.equal(renameTargets.includes(safeOutput), true, "publication rewrote the caller's lexical output path");

  for (const path of invalidPaths) assert.throws(() => validateSafeRelativePath(path));
});

test("recursive symlinks, special files, and bounded resource exhaustion fail closed", async (t) => {
  const symlinked = await makeFixture();
  t.after(() => fs.rm(symlinked.base, { recursive: true, force: true }));
  const outside = join(symlinked.base, "outside.txt");
  await fs.writeFile(outside, "outside\n");
  await fs.symlink(outside, join(symlinked.root, "public", "nested", "escape.txt"));
  await assert.rejects(
    buildSite({ ...symlinked, publicPaths: ["public"], logger: quietLogger }),
    /may not traverse a symlink|may not be a symlink/
  );
  await assertPriorArtifactPreserved(symlinked);

  const hardlinked = await makeFixture();
  t.after(() => fs.rm(hardlinked.base, { recursive: true, force: true }));
  const excluded = join(hardlinked.base, "excluded.txt");
  await fs.writeFile(excluded, "excluded bytes\n");
  await fs.link(excluded, join(hardlinked.root, "public", "nested", "hardlink.txt"));
  await assert.rejects(
    buildSite({ ...hardlinked, publicPaths: ["public"], logger: quietLogger }),
    /hard link/
  );
  await assertPriorArtifactPreserved(hardlinked);

  const special = await makeFixture();
  t.after(() => fs.rm(special.base, { recursive: true, force: true }));
  await execFileAsync("mkfifo", [join(special.root, "public", "pipe")]);
  await assert.rejects(
    buildSite({ ...special, publicPaths: ["public"], logger: quietLogger }),
    /regular file or directory/
  );
  await assertPriorArtifactPreserved(special);

  const oversized = await makeFixture();
  t.after(() => fs.rm(oversized.base, { recursive: true, force: true }));
  const oversizedPath = join(oversized.root, "public", "oversized.bin");
  const handle = await fs.open(oversizedPath, "w");
  await handle.truncate(MAX_PUBLIC_FILE_BYTES + 1);
  await handle.close();
  await assert.rejects(
    buildSite({ ...oversized, publicPaths: ["public"], logger: quietLogger }),
    /exceeds the .*byte limit/
  );
  await assertPriorArtifactPreserved(oversized);

  const aggregate = await makeFixture();
  t.after(() => fs.rm(aggregate.base, { recursive: true, force: true }));
  await assert.rejects(
    buildSite({ ...aggregate, publicPaths: ["public"], maxTotalBytes: 5, logger: quietLogger }),
    /aggregate limit/
  );
  await assertPriorArtifactPreserved(aggregate);

  const entries = await makeFixture();
  t.after(() => fs.rm(entries.base, { recursive: true, force: true }));
  await assert.rejects(
    buildSite({ ...entries, publicPaths: ["public"], maxEntries: 2, logger: quietLogger }),
    /entry limit/
  );
  await assertPriorArtifactPreserved(entries);

  const exactBoundary = await makeFixture();
  t.after(() => fs.rm(exactBoundary.base, { recursive: true, force: true }));
  await fs.rm(join(exactBoundary.root, "public", "nested"), { recursive: true });
  await fs.writeFile(join(exactBoundary.root, "public", "file.txt"), "1234");
  await buildSite({ ...exactBoundary, publicPaths: ["public"], maxFileBytes: 4, logger: quietLogger });
  assert.equal(await fs.readFile(join(exactBoundary.output, "public", "file.txt"), "utf8"), "1234");
});

test("the publication lock excludes a concurrent builder", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.base, { recursive: true, force: true }));
  const copyStarted = deferred();
  const releaseCopy = deferred();
  let paused = false;
  const delayedFs = {
    ...defaultFileSystem,
    async copyFile(...args) {
      if (!paused) {
        paused = true;
        copyStarted.resolve();
        await releaseCopy.promise;
      }
      return defaultFileSystem.copyFile(...args);
    }
  };

  const first = buildSite({ ...fixture, publicPaths: ["public"], fsApi: delayedFs, logger: quietLogger });
  await copyStarted.promise;
  try {
    await assert.rejects(
      buildSite({ ...fixture, publicPaths: ["public"], logger: quietLogger }),
      (error) => error?.code === "BUILD_LOCKED"
    );
    assert.equal(await fs.readFile(join(fixture.output, "sentinel.txt"), "utf8"), "prior artifact\n");
  } finally {
    releaseCopy.resolve();
  }
  await first;
  assert.equal(await fs.readFile(join(fixture.output, "public", "file.txt"), "utf8"), "new artifact\n");
  await assert.rejects(fs.lstat(`${fixture.output}.lock`), { code: "ENOENT" });
});

test("copy and promotion failures leave the complete prior artifact in place", async (t) => {
  const corrupted = await makeFixture();
  t.after(() => fs.rm(corrupted.base, { recursive: true, force: true }));
  const corruptingFs = {
    ...defaultFileSystem,
    async copyFile(_source, target) {
      await fs.writeFile(target, "corrupt\n");
    }
  };
  await assert.rejects(
    buildSite({ ...corrupted, publicPaths: ["public"], fsApi: corruptingFs, logger: quietLogger }),
    /changed while the artifact was being copied/
  );
  await assertPriorArtifactPreserved(corrupted);

  const reorderedSource = await makeFixture();
  t.after(() => fs.rm(reorderedSource.base, { recursive: true, force: true }));
  let injected = false;
  const mutatingFs = {
    ...defaultFileSystem,
    async copyFile(source, target) {
      await defaultFileSystem.copyFile(source, target);
      if (!injected) {
        injected = true;
        await fs.writeFile(join(reorderedSource.root, "public", "late.txt"), "late arrival\n");
      }
    }
  };
  await assert.rejects(
    buildSite({ ...reorderedSource, publicPaths: ["public"], fsApi: mutatingFs, logger: quietLogger }),
    /source tree changed while the artifact was being staged/i
  );
  await assertPriorArtifactPreserved(reorderedSource);

  const promotion = await makeFixture();
  t.after(() => fs.rm(promotion.base, { recursive: true, force: true }));
  const promotionFs = {
    ...defaultFileSystem,
    async rename(source, target) {
      if (target === promotion.output && basename(source).startsWith(".site.stage-")) {
        const error = new Error("injected promotion failure");
        error.code = "EIO";
        throw error;
      }
      return defaultFileSystem.rename(source, target);
    }
  };
  await assert.rejects(
    buildSite({ ...promotion, publicPaths: ["public"], fsApi: promotionFs, logger: quietLogger }),
    /injected promotion failure/
  );
  await assertPriorArtifactPreserved(promotion);
});

test("a post-success rename exception is recognized as a completed atomic promotion", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.base, { recursive: true, force: true }));
  let injected = false;
  const warnings = [];
  const postSuccessFs = {
    ...defaultFileSystem,
    async rename(source, target) {
      await defaultFileSystem.rename(source, target);
      if (!injected && target === fixture.output && basename(source).startsWith(".site.stage-")) {
        injected = true;
        const error = new Error("injected post-success promotion exception");
        error.code = "EIO";
        throw error;
      }
    }
  };

  await buildSite({
    ...fixture,
    publicPaths: ["public"],
    fsApi: postSuccessFs,
    logger: { log() {}, warn(value) { warnings.push(value); } }
  });

  assert.equal(injected, true, "the post-success fault was not exercised");
  assert.equal(await fs.readFile(join(fixture.output, "public", "file.txt"), "utf8"), "new artifact\n");
  await assert.rejects(fs.lstat(join(fixture.output, "sentinel.txt")), { code: "ENOENT" });
  const names = await fs.readdir(fixture.base);
  assert.equal(names.some((name) => name === "site.lock"), false, "publication lock leaked");
  assert.equal(names.some((name) => name.startsWith(".site.stage-")), false, "publication stage leaked");
  assert.equal(names.some((name) => name.startsWith(".site.backup-")), false, "publication backup leaked");
  assert.equal(warnings.some((warning) => /completed although/.test(warning.message)), true);
});

test("ambiguous rename outcomes are authenticated and byte-verified before replacing the prior artifact", async (t) => {
  const preBackupOwnership = await makeFixture();
  t.after(() => fs.rm(preBackupOwnership.base, { recursive: true, force: true }));
  const preBackupForeign = join(preBackupOwnership.base, "pre-backup-owner");
  await fs.mkdir(preBackupForeign);
  await fs.writeFile(join(preBackupForeign, "foreign.txt"), "CONCURRENT OWNER\n");
  let swappedBeforeInspection = false;
  const preBackupRaceFs = {
    ...defaultFileSystem,
    async mkdtemp(prefix, options) {
      const created = await defaultFileSystem.mkdtemp(prefix, options);
      if (!swappedBeforeInspection && basename(prefix).startsWith(".site.backup-")) {
        swappedBeforeInspection = true;
        await defaultFileSystem.rm(preBackupOwnership.output, { recursive: true, force: true });
        await defaultFileSystem.rename(preBackupForeign, preBackupOwnership.output);
      }
      return created;
    }
  };
  await assert.rejects(
    buildSite({ ...preBackupOwnership, publicPaths: ["public"], fsApi: preBackupRaceFs, logger: quietLogger }),
    /source ownership was lost/
  );
  assert.equal(swappedBeforeInspection, true);
  assert.equal(await fs.readFile(join(preBackupOwnership.output, "foreign.txt"), "utf8"), "CONCURRENT OWNER\n");

  const backupOwnership = await makeFixture();
  t.after(() => fs.rm(backupOwnership.base, { recursive: true, force: true }));
  const foreignSource = join(backupOwnership.base, "foreign-owner");
  await fs.mkdir(foreignSource);
  await fs.writeFile(join(foreignSource, "foreign.txt"), "CONCURRENT OWNER\n");
  let swappedBeforeBackup = false;
  const backupRaceFs = {
    ...defaultFileSystem,
    async rename(source, target) {
      if (!swappedBeforeBackup && source === backupOwnership.output && basename(target) === "artifact") {
        swappedBeforeBackup = true;
        await defaultFileSystem.rm(source, { recursive: true, force: true });
        await defaultFileSystem.rename(foreignSource, source);
      }
      return defaultFileSystem.rename(source, target);
    }
  };
  await assert.rejects(
    buildSite({ ...backupOwnership, publicPaths: ["public"], fsApi: backupRaceFs, logger: quietLogger }),
    /ownership was lost|backup preparation failed/
  );
  assert.equal(swappedBeforeBackup, true);
  const preservedBackup = (await fs.readdir(backupOwnership.base)).find((name) => name.startsWith(".site.backup-"));
  assert.ok(preservedBackup, "the foreign replacement was deleted after backup ownership changed");
  assert.equal(
    await fs.readFile(join(backupOwnership.base, preservedBackup, "artifact", "foreign.txt"), "utf8"),
    "CONCURRENT OWNER\n"
  );

  const falsePostcondition = await makeFixture();
  t.after(() => fs.rm(falsePostcondition.base, { recursive: true, force: true }));
  let injectedFalseTarget = false;
  const falseTargetFs = {
    ...defaultFileSystem,
    async rename(source, target) {
      if (!injectedFalseTarget && target === falsePostcondition.output && basename(source).startsWith(".site.stage-")) {
        injectedFalseTarget = true;
        await defaultFileSystem.rm(source, { recursive: true, force: true });
        await defaultFileSystem.mkdir(target);
        await defaultFileSystem.writeFile(join(target, "attacker.txt"), "unrelated artifact\n");
        const error = new Error("injected false rename postcondition");
        error.code = "EIO";
        throw error;
      }
      return defaultFileSystem.rename(source, target);
    }
  };
  await assert.rejects(
    buildSite({ ...falsePostcondition, publicPaths: ["public"], fsApi: falseTargetFs, logger: quietLogger }),
    (error) => {
      const errors = error instanceof AggregateError ? [error, ...error.errors] : [error];
      assert.match(
        errors.map((candidate) => candidate?.message ?? String(candidate)).join("\n"),
        /false rename postcondition|Promoted artifact failed byte-for-byte verification/
      );
      return true;
    }
  );
  assert.equal(injectedFalseTarget, true);
  await assertUniqueFilePreserved(falsePostcondition.base, "attacker.txt", "unrelated artifact\n");
  await assertUniqueFilePreserved(falsePostcondition.base, "sentinel.txt", "prior artifact\n");

  const corruptedAfterRename = await makeFixture();
  t.after(() => fs.rm(corruptedAfterRename.base, { recursive: true, force: true }));
  let injectedCorruption = false;
  const corruptingRenameFs = {
    ...defaultFileSystem,
    async rename(source, target) {
      await defaultFileSystem.rename(source, target);
      if (!injectedCorruption && target === corruptedAfterRename.output && basename(source).startsWith(".site.stage-")) {
        injectedCorruption = true;
        await defaultFileSystem.writeFile(join(target, "public", "file.txt"), "corrupt after rename\n");
        const error = new Error("injected mutated post-success rename");
        error.code = "EIO";
        throw error;
      }
    }
  };
  await assert.rejects(
    buildSite({ ...corruptedAfterRename, publicPaths: ["public"], fsApi: corruptingRenameFs, logger: quietLogger }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.match(error.message, /failed output was preserved/);
      assert.equal(error.errors.some((entry) => /byte-for-byte verification/.test(entry.message)), true);
      return true;
    }
  );
  assert.equal(injectedCorruption, true);
  await assertPriorArtifactPreserved(corruptedAfterRename);
  const failedArtifact = (await fs.readdir(corruptedAfterRename.base))
    .find((name) => name.startsWith(".site.failed-"));
  assert.ok(failedArtifact, "the failed promoted artifact was not quarantined");
  assert.equal(
    await fs.readFile(join(corruptedAfterRename.base, failedArtifact, "artifact", "public", "file.txt"), "utf8"),
    "corrupt after rename\n"
  );

  const postInspectionSwap = await makeFixture();
  t.after(() => fs.rm(postInspectionSwap.base, { recursive: true, force: true }));
  const foreignAfterInspection = join(postInspectionSwap.base, "foreign-after-inspection");
  await fs.mkdir(foreignAfterInspection);
  await fs.writeFile(join(foreignAfterInspection, "foreign.txt"), "CONCURRENT OWNER\n");
  let promotionFinished = false;
  let swappedAfterInspection = false;
  const postInspectionRaceFs = {
    ...defaultFileSystem,
    async rename(source, target) {
      if (
        promotionFinished
        && !swappedAfterInspection
        && source === postInspectionSwap.output
        && basename(target) === "artifact"
        && basename(dirname(target)).startsWith(".site.failed-")
      ) {
        swappedAfterInspection = true;
        await defaultFileSystem.rm(source, { recursive: true, force: true });
        await defaultFileSystem.rename(foreignAfterInspection, source);
      }
      await defaultFileSystem.rename(source, target);
      if (target === postInspectionSwap.output && basename(source).startsWith(".site.stage-")) {
        promotionFinished = true;
        await defaultFileSystem.writeFile(join(target, "public", "file.txt"), "corrupt before rollback\n");
      }
    }
  };
  await assert.rejects(
    buildSite({
      ...postInspectionSwap,
      publicPaths: ["public"],
      fsApi: postInspectionRaceFs,
      logger: quietLogger
    }),
    /failed output was preserved/
  );
  assert.equal(swappedAfterInspection, true, "the post-inspection replacement race was not exercised");
  assert.equal(await fs.readFile(join(postInspectionSwap.output, "sentinel.txt"), "utf8"), "prior artifact\n");
  const preservedForeign = (await fs.readdir(postInspectionSwap.base))
    .find((name) => name.startsWith(".site.failed-"));
  assert.ok(preservedForeign, "the foreign replacement recovery directory was discarded");
  assert.equal(
    await fs.readFile(join(postInspectionSwap.base, preservedForeign, "artifact", "foreign.txt"), "utf8"),
    "CONCURRENT OWNER\n"
  );

  const foreignReplacement = await makeFixture();
  t.after(() => fs.rm(foreignReplacement.base, { recursive: true, force: true }));
  let promotionCompleted = false;
  let injectedReplacement = false;
  const replacingFs = {
    ...defaultFileSystem,
    async rename(source, target) {
      await defaultFileSystem.rename(source, target);
      if (target === foreignReplacement.output && basename(source).startsWith(".site.stage-")) {
        promotionCompleted = true;
      }
    },
    async readdir(path, ...args) {
      if (promotionCompleted && !injectedReplacement && path === foreignReplacement.output) {
        injectedReplacement = true;
        await defaultFileSystem.rm(path, { recursive: true, force: true });
        await defaultFileSystem.mkdir(path);
        await defaultFileSystem.writeFile(join(path, "foreign.txt"), "CONCURRENT OWNER\n");
      }
      return defaultFileSystem.readdir(path, ...args);
    }
  };
  await assert.rejects(
    buildSite({ ...foreignReplacement, publicPaths: ["public"], fsApi: replacingFs, logger: quietLogger }),
    (error) => {
      const messages = error instanceof AggregateError ? error.errors.map((entry) => entry.message) : [error.message];
      assert.equal(
        messages.some((message) => /ownership was lost|byte-for-byte verification/.test(message)),
        true
      );
      return true;
    }
  );
  assert.equal(injectedReplacement, true);
  await assertUniqueFilePreserved(foreignReplacement.base, "foreign.txt", "CONCURRENT OWNER\n");
  await assertUniqueFilePreserved(foreignReplacement.base, "sentinel.txt", "prior artifact\n");
});

test("the injectable publication CLI runner records a failing process status", async () => {
  const processApi = { exitCode: 0 };
  const expected = new Error("injected CLI build failure");
  const result = await runBuildSiteCli({
    build: async () => { throw expected; },
    processApi,
    logger: { error() { throw new Error("broken logger"); } }
  });

  assert.equal(result, 1);
  assert.equal(processApi.exitCode, 1);
});
